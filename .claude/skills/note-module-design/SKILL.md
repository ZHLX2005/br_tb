---
name: note-module-design
description: 当用户要扩展/修改 TabBoard 的便签(note)模块功能、改 WYSIWYG 编辑器、改图床截图对接、新增 noteRing 与 note module 双端共享能力、或排查 Mixed Content / 截帧 / 登录态问题时触发。沉淀 note 模块的「双端同源 + background service + 独立截帧工具」完整架构、覆盖文件清单与扩展方法。
---

# note-module-design — 便签模块架构与扩展指南

> 沉淀 TabBoard note 模块的完整设计。note 模块是「双端同源」的 contenteditable WYSIWYG 便签,支持视频帧截取 → 图床上传 → `[[URL]]` 图片块渲染。

## 一、模块全貌:三层 + 双端

```
┌─────────────────────────────────────────────────────────────┐
│  background/notes.js  (唯一后端 service, NOTE_ACTIONS Set)    │
│    ├─ uploadNoteImage    登录+上传+token缓存+401重试          │
│    ├─ fetchImageAsDataUrl SW fetch http图 → dataURL(绕MC)    │
│    ├─ getLoginStatus / ensureLogin  通用登录态 service       │
│    └─ notePages CRUD + boundTabs + 全局默认 page id          │
└─────────────────────────────────────────────────────────────┘
            ▲ chrome.runtime.sendMessage(content/module 都走这条)
            │
   ┌────────┴────────┐                      ┌──────────────────┐
   │ content/noteRing │  注入端(视频页)      │ modules/note     │  看板端
   │ contenteditable  │                      │ contenteditable  │
   │ WYSIWYG 编辑器   │                      │ WYSIWYG 编辑器   │
   │ Ctrl+B 截帧      │                      │ 登录面板(canonical)│
   │ Ctrl+V 粘贴上传  │                      │ Ctrl+V 粘贴上传  │
   └────────┬─────────┘                      └────────┬─────────┘
            │                                         │
            └──────── chrome.storage.local.notePages ─┘
                       (存储同源, onChanged 双向同步)
```

**关键约束**:
- noteRing 是 content script → **无 `chrome.tabs`**,只能 `chrome.runtime.sendMessage` 走 background
- module 是 `chrome-extension://` 页 → 有完整 chrome API,但**无视频宿主**(不截帧)
- 截帧只在 noteRing(它就在视频页 DOM 里)

## 二、覆盖文件清单(改动 note 模块必经之地)

| 文件 | 职责 | 改动场景 |
|------|------|---------|
| `background/notes.js` | 后端 service(`NOTE_ACTIONS` Set 分发) | 加新 action、改上传/登录逻辑 |
| `content/videoFrameCapture.js` | 独立截帧工具 `window.__tabboardVideoFrameCapture.capture()` | 改截帧策略(选视频/缩放/CORS) |
| `content/content.js` | content 消息转发(`captureVideoFrame`→工具) | 加 content 端消息处理 |
| `content/noteRing.js` | 注入端 UI + WYSIWYG 编辑器(`nr-` 前缀) | 改注入端编辑体验、快捷键、UI |
| `modules/note/view.js` | 看板端 UI + WYSIWYG 编辑器(`note-` 前缀) | 改看板端编辑、登录面板 |
| `modules/note/style.css` | 看板端图片块样式(`.note-img-block`) | 改图片块视觉 |
| `manifest.json` | 注入 videoFrameCapture.js + host_permissions | 加新 content script、新 host |

## 三、核心数据模型

```js
chrome.storage.local.notePages = [
  {
    id, name,
    content,        // ★ 字符串,含 [[URL]] 占位(图片) + 纯文本
    createdAt, updatedAt,
    boundTabs: [{ url, title, favicon }]
  }
]
chrome.storage.local.noteUpload = {
  email, password,        // 凭证
  token, tokenExpiry      // 登录后缓存(30 天),401 自动重登
}
chrome.storage.local.noteCurrentPageId  // 全局默认选中页(跨 tab 共享)
```

**`[[URL]]` 是图片块的序列化标记** —— 渲染时变成 `<span class="nr-img-block" data-url=URL><img></span>`,序列化时还原。两端语义必须一致。

## 四、扩展方法(三类典型扩展)

### 1. 加新的 background action(最常见)

```
1. background/notes.js:
   - NOTE_ACTIONS Set 加 'yourAction'
   - switch 加 case,逻辑写在这
2. content/noteRing.js 或 modules/note/view.js:
   - chrome.runtime.sendMessage({ action: 'yourAction', ...params })
   - 或 dataManager.sendMessage('yourAction', { ...params })(module)
```

### 2. 改编辑器(图片块行为)

两端各维护一份等价逻辑(无 build,避免运行时依赖):
- `renderContentToEditor(editor, content)` — 文本 → DOM(图片块)
- `serializeEditor(editor)` — DOM → 文本(`[[URL]]`)
- `bindEditorEvents` — input/keydown/paste/selectionchange/blur
- `syncImageActiveState` / `activateImageAsSource` / `deactivateAllImages` — 光标感知
- `proxyEditorImages` — http 图走 SW 转 dataURL
- `makeImageBlock(url)` / `insertImageBlockAtCursor(editor, url)`
- `onDeleteImgClick` — 删图片块

> **改一处必须同步另一端**,class 前缀不同(`nr-` vs `note-`),但语义、序列化格式必须完全一致,否则两端互相读写会错乱。

### 3. 加新的截图来源(粘贴已是范例)

```
1. 拿到 dataURL(任意来源:截帧/粘贴/拖拽/文件选择)
2. 凭证预检:chrome.runtime.sendMessage({action:'getLoginStatus'})
3. 上传:chrome.runtime.sendMessage({action:'uploadNoteImage', dataUrl})
4. 插入:insertImageBlockAtCursor(editor, res.url)
5. 代理:proxyEditorImages(editor)  // http 图转 dataURL
6. 防抖保存:scheduleEditorSave(editor)
```

参考 `onEditorPaste`(两端都有)—— 这是 Ctrl+V 粘贴上传的完整实现,Ctrl+B 截帧同理。

## 五、关键认知(踩坑换来的)

| 认知 | 误解 | 真相 |
|------|------|------|
| Mixed Content | 扩展 fetch 不受限 | **只有 background SW 的 fetch 不受**;content script fetch **同样受限** |
| img src 设置时机 | 先设 http src 再代理 | 渲染瞬间浏览器已发请求 → 警告。**用 `data-pending-src` 占位**,代理后设 src |
| 登录 UI 位置 | 注入端也能配 | 登录是通用 service,UI **集中在 module**,注入端只显示状态徽章+跳转 |
| 截帧位置 | module 也能截 | module 无视频宿主,**只 noteRing 截帧** |
| 快捷键选择 | Ctrl+Shift+C 顺手 | Chrome「检查元素」抢占,content script 收不到。**Ctrl+B**,且 keydown 加 `capture:true` |
| 焦点守卫 | isContentEditable 时拦截 | 用户截帧时光标就在编辑器里,守卫反而挡掉。**只让出 INPUT** |
| token 共享 | 各端各自登录 | 全在 `noteUpload` storage,**任何 background 调用读同一份**,注入端只需查状态 |

## 六、错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| noteRing 加截帧按钮但走 content script fetch 上传 | 上传本身 OK,但出图时 Mixed Content 拦截 | 上传走 background OK;**图片显示**必须走 SW `fetchImageAsDataUrl` |
| `<img src="http://47...">` 直接渲染 | 控制台一堆 Mixed Content 警告,图也不显示 | `data-pending-src` 占位 + `proxyEditorImages` 转后设 src |
| noteRing 放邮箱/密码输入框 | 注入端不该承担账号管理,且重渲染丢监听 | 登录面板**只在 module**,noteRing 用状态徽章查 `getLoginStatus` |
| module 加「截帧上传」按钮 | module 是看板页,无视频 DOM,截帧永远失败 | 截帧**只 noteRing**,module 只保留粘贴上传 |
| 预览/源码切换模型 | 用户要所见即所得,切换多余 | contenteditable WYSIWYG,光标进入图片块临时显源码 |
| 改一端编辑器逻辑不同步另一端 | 两端序列化格式漂移,互相读写错乱 | 两份等价实现,改动**必须同步**,保持 `[[URL]]` 语义一致 |
| 快捷键用 Ctrl+Shift+C | 浏览器抢占,收不到 | 用未被占用的键(本项目用 Ctrl+B),keydown 监听加 `capture:true` |
| content script 自己 `chrome.tabs.query` | content script 无 chrome.tabs API | 走 `chrome.runtime.sendMessage` 让 background 代查 |

## 七、调试入口

- **截帧不工作**:`window.__tabboardVideoFrameCapture.capture()` 控制台直测
- **上传失败**:看 background SW 控制台(service worker 日志),检查 `noteUpload` 凭证 + token
- **图片不显示**:看 `fetchImageAsDataUrl` 返回,F12 Network 看是否 Mixed Content
- **快捷键失效**:keydown 监听是否 `capture:true`、`isExpanded` 是否 true、焦点守卫是否过严

## 引用索引

| 相关 skill | 何时读 |
|-----------|--------|
| `injected-dom-toggle-pattern` | noteRing 作为注入 DOM 圆环的通用模式 |
| `module-extension-guide` | 在 TabBoard 模块化架构里新增/扩展模块 |
| `video-tracker` | 视频检测/进度追踪(截帧依赖 videoTracker 的视频发现) |
