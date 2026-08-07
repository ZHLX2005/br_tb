# 注入式 DOM 与 TabBoard Module 协作（共享数据 + 双向同步）

> 当注入 UI（content script 里的圆环/侧边栏）需要与 TabBoard 内嵌 module（`modules/<feature>/`）**共享同一份数据**时——两边看到同一批数据，任何一边修改，另一边自动刷新。

**典型场景**：便签圆环（注入 DOM）与便签页 module（TabBoard 视图）共用一个 `notePages` 数据源。圆环上随手记的笔记，打开 TabBoard 便签模块能看到；模块里整理的，圆环也能实时同步。

## 架构总览

```
                    ┌──────────────────────┐
                    │  background/notes.js │  ← 唯一写路径（CRUD actions）
                    │  chrome.storage.local │
                    └──────────┬───────────┘
                               │ chrome.storage.onChanged 广播
              ┌────────────────┴─────────────────┐
              ▼                                   ▼
   ┌───────────────────┐              ┌───────────────────┐
   │  注入 DOM          │              │  TabBoard module  │
   │  content/xxx.js   │              │  modules/note/    │
   │  (content script) │              │  (扩展内嵌页面)    │
   └───────────────────┘              └───────────────────┘
```

## 五条核心规则

### 1. 数据源唯一：共享同一个 `chrome.storage.local` key

注入 DOM 和 module **不要各存一份**。用一个 key（如 `notePages`），两边都从它读写：

- `background/init.js`：初始化该 key（`[]` / `{}`）
- `modules/shared/data-manager.js`：把 key 加进 `this.data` + `loadData()` + getter（module 侧）
- 注入 DOM 侧：`chrome.storage.local.get([key])` 直接读

### 2. 写操作唯一：全部走 background action

两边**都不要直接 `chrome.storage.local.set({ [key]: ... })`** 整体覆盖——会和其他字段冲突 / 绕过验证。统一通过 `chrome.runtime.sendMessage({ action, ...payload })` 发给 background，由 background 的 `case` 分支做合并语义写入：

```javascript
// background/notes.js — 唯一写路径
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const a = request?.action;
  if (!a || !NOTE_ACTIONS.has(a)) return false;   // 白名单
  (async () => {
    let result = { success: true };
    switch (a) {
      case 'updateNoteContent': {
        const notePages = await loadPages();
        const page = notePages.find(p => p.id === request.id);
        page.content = (request.content || '').toString();
        await savePages(notePages);                // ← 唯一 set
        result = { success: true, page };
        break;
      }
      // ...
    }
    sendResponse(result);
  })();
  return true;                                     // async 必须 return true
});
```

### 3. 同步总线：`chrome.storage.onChanged` 双向广播

background 写完 storage 后，Chrome 自动触发 `chrome.storage.onChanged`。**注入 DOM 和 module 都监听它**，任何一边写入，两边都刷新：

```javascript
// 注入 DOM 侧
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.notePages) return;
  const newPages = changes.notePages.newValue || [];
  // 处理 activePageId 失效、更新 picker/列表...
  render();
});

// module 侧(data-manager.js 已有转发,或直接监听)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.notePages) return;
  this.pages = changes.notePages.newValue || [];
  this.render();
});
```

> 注意：注入 DOM 的 content script 和扩展页面都能用 `chrome.storage.onChanged`，两边天然收到广播，无需手动发消息同步。

### 4. 防回环：自己保存触发的 onChanged 不要打断编辑

最关键的坑。用户在**编辑器**里打字 → debounce 保存 → `chrome.storage.onChanged` → 若此时重渲染整个编辑器 → **光标丢失、内容闪烁、打字被打断**。

**解法 A（推荐）：只刷新"列表类" UI,不重建编辑器**。用"签名"判断变化是不是来自自己：

```javascript
chrome.storage.onChanged.addListener((changes, area) => {
  const newPages = changes.notePages.newValue || [];
  // 比对页面列表签名(数量/名称/绑定),不含 content —— content 变化不重建编辑器
  const oldSig = pages.map(p => `${p.id}:${p.name}:${p.boundTabs?.length}`).join('|');
  const newSig = newPages.map(p => `${p.id}:${p.name}:${p.boundTabs?.length}`).join('|');
  const listChanged = oldSig !== newSig;
  pages = newPages;
  if (!activePageId || !newPages.find(p => p.id === activePageId)) {
    activePageId = newPages[0]?.id || null;
    render();          // 当前页失效才完整重建
    return;
  }
  if (listChanged) {
    renderHeader(); renderPicker(); renderTabHint();   // 只刷列表类 UI
  }
  // content 变化:不重建编辑器,保持焦点
});
```

**解法 B（临时）**：保存后用一个标志位跳过本次 onChanged。但容易漏、有竞态，不如解法 A。

### 5. 保存防抖 + 切换前 flush

编辑器输入 → debounce（如 500ms）后调 background action 保存。**切换页面 / 删除 / 收起前必须先 flush** 未保存的改动，否则切走丢字：

```javascript
let _timer = null;
function scheduleSave(content) {
  clearTimeout(_timer);
  _timer = setTimeout(() => doSave(content), 500);
}
async function flushSave() {          // 切换前调用
  if (!_timer) return;
  clearTimeout(_timer); _timer = null;
  const article = panel.querySelector('textarea');
  if (article && activePageId) await doSave(article.value);
}
async function selectPage(id) {
  await flushSave();                  // 先保存当前页
  activePageId = id;
  render();
}
```

## 消息 action 命名的坑（`startsWith` 过滤错）

**症状**：所有 CRUD 按钮按下没反应,Promise 永远 pending,console 无报错。

**根因**：background 监听器用 `action.startsWith('note')` 做白名单过滤,但真实 action 是 `'createNotePage'` / `'addNoteItem'` / `'updateNoteContent'` 这类 **camelCase**,没有一个以 `'note'` 字面开头 → 全部被 `return false` 拒收,`sendResponse` 永不调用 → 发送方挂死。

```javascript
// ❌ startsWith('note') 匹配不到 'createNotePage'(camelCase)
if (!a || !a.startsWith('note')) return false;

// ✅ 显式 Set 白名单
const ACTIONS = new Set(['createNotePage', 'renameNotePage', 'deleteNotePage', 'updateNoteContent', ...]);
if (!a || !ACTIONS.has(a)) return false;
```

## 数据模型约定

两边共享的数据结构,字段命名要明确区分"列表元信息"与"正文内容",便于签名比较：

```javascript
// notePages 示例:content 是正文(会被频繁更新),其余是列表元信息
{
  id: 'p_...',
  name: '便签页名',
  content: '整篇文章全文...',      // 频繁变化,签名比较时排除
  createdAt: '...', updatedAt: '...',
  boundTabs: [{ url, title, favicon }]   // 绑定关系
}
```

## 反模式表

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 注入 DOM 和 module 各存一份数据 | 两边不同步,改了一边另一边看不到 | 共享同一 storage key |
| 直接 `storage.set({ [key]: value })` 整体覆盖 | 清掉其他字段 | 全部走 background action（合并语义） |
| onChanged 里重渲染整个编辑器 | 自己保存触发 onChanged → 光标丢、打字被打断 | 只刷新列表类 UI,签名比较排除 content |
| 切换页面前不 flush 未保存内容 | 切走丢字 | 切换/删除/收起前先 flush |
| background 用 `startsWith('note')` 过滤 | camelCase action 全被拒,CRUD 失效 | 显式 Set 白名单 |
| async listener 不 `return true` | sendResponse 收不到,发送方挂死 | async 分支末尾 `return true` |

## 检查清单

- [ ] 注入 DOM 与 module 共享同一 storage key
- [ ] 所有写操作走 background action（无直接 storage.set 覆盖）
- [ ] 两边都监听 `chrome.storage.onChanged` 实现双向同步
- [ ] 编辑器保存 debounce（500ms）+ 切换前 flush
- [ ] onChanged 只刷新列表类 UI,不重建编辑器（签名比较排除正文）
- [ ] background action 用显式 Set 白名单（不用 startsWith 过滤）
- [ ] async listener `return true`
- [ ] 删除/创建页面后 activePageId 失效回退逻辑存在