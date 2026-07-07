# 2026-07-07 — "无法打开 > xxx 相关系统页面"

## 症状

用户报告:在 Alt+Shift+S focus-search 浮层中输入 `>` 开头的查询(如 `> 设置`、`> 书签`),按 Enter 后**没有反应,目标系统页打不开**。

补充:timeline 路径下打开 edge:// 类 URL 是正常的。

## 根因

`background/groups.js` 的 `case 'openTab':` 调用 `chrome.tabs.query({ url })` 做去重。Chrome Match Pattern 合法 scheme 列表(https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)只包含 `http`、`https`、`file`、`ftp`、`ws`、`wss`、`chrome-extension`,**`chrome://`、`edge://`、`chrome-extension://`、`about:`、`devtools://` 等受限 scheme 不在内**,query 直接抛错(`Error: The url field "chrome://settings" is invalid. urls must use a permitted scheme.`)。

整个 case 没有外层 try/catch:
- await reject → 后续 `tabs.create` 不执行 → sendResponse 永远不调用
- channel 关闭 → content 端 `chrome.runtime.lastError`(`The message port closed before a response was received.`)
- content 端(focus-search.js)只在 console.warn,UI 无任何反馈
- 用户看到的就是"按 Enter 没反应"

注释里"query 对 edge:// 返回空是正常的"是**错误判断**,导致之前的修补方向都偏了 — 真正的修复方向是 query 失败时 fallback 到 create。

timeline 能开 edge:// 是因为 `openGroup` 路径(`background/groups.js:417`)直接调 `chrome.tabs.create`,**没有 query 步骤**,绕过了这个 bug。

## 修复

### 1. `background/groups.js` openTab case 加外层 try/catch(query → fallback 到 create)

```js
case 'openTab': {
  const url = request.url;
  try {
    if (url) {
      const existing = await chrome.tabs.query({ url: url });
      // ... 去重逻辑 ...
    }
  } catch (queryErr) {
    console.warn('[TabBoard] openTab query failed for', url, '- falling back to create:', queryErr.message);
  }
  try {
    await chrome.tabs.create({ url: url });
    sendResponse({ success: true });
  } catch (createErr) {
    sendResponse({ success: false, error: createErr.message });
  }
  break;
}
```

### 2. `background/groups.js` openGroup 循环单 tab try/catch(防御加固)

```js
let opened = 0;
const failed = [];
for (const tab of groupTabs) {
  if (!tab || !tab.url) continue;
  try {
    await chrome.tabs.create({ url: tab.url });
    opened++;
  } catch (e) {
    console.warn('[TabBoard] openGroup skipped', tab.url, '-', e.message);
    failed.push({ url: tab.url, error: e.message });
  }
}
sendResponse({ success: true, opened, failed: failed.length, failures: failed });
```

### 3. `content/focus-search.js` URL 拼接 `chrome://` 双斜杠

```js
// 错误(单斜杠):
var fullUrl = protocol + ':' + page.path;  // → "chrome:/settings"
// 正确:
var fullUrl = protocol + '://' + page.path.replace(/^\/+/, '');  // → "chrome://settings"
```

两处都修:`devPageToResult` 和 `filterAndSortSystemPages`。

### 4. `content/focus-search.js` 失败时显示 toast

focus-search 注入到任意网页,不能依赖 background 的 showToast 通道,自己画迷你 toast:

```js
function showErrorToast(message) {
  var el = document.createElement('div');
  el.id = 'focus-search-error-toast';
  el.textContent = message;
  el.style.cssText = 'position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); ...';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
```

在 `jumpToSelected` 的 system 分支,`lastError` 和 `response.success === false` 时调用。

## 教训

### 教训 1:Chrome 扩展 API 对受限 URL 的默认行为是抛错,不是返回空

之前认知错误导致修复方向偏离。所有涉及 `chrome.tabs.query` / `chrome.tabs.create` / `chrome.tabs.update` 的代码,涉及动态 URL 时必须有 try/catch。

**检查项**:见主文档"模式 1"。

### 教训 2:Content script 失败必须显示 UI 反馈

`console.warn` 对终端用户是隐形的。任何 sendMessage 调用都必须:
- 检查 `chrome.runtime.lastError`
- 检查 `response.success`(如果有 response)
- 失败时显示 toast 或其他 UI

### 教训 3:Service worker async handler 必有外层 try/catch + sendResponse

MV3 service worker 内,await reject 若不 catch,后续 await 不会执行,sendResponse 永远不被调用 → channel 关闭 → content 端无声失败。

**每个 listener case 都应该包成**:
```js
case 'xxx': {
  try {
    // 业务逻辑
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
  break;
}
```

### 教训 4:URL 拼接必须用标准形式

字符串拼接容易出错(`'chrome:' + '/settings'` 单斜杠)。**显式写 `'chrome://'` + path(去前导 `/`)**,而不是 `':' + path`。

## 影响范围(其他可能受同样问题影响的调用点)

- `background/focus.js` 的 `handleFocusSearchSwitchTab`(line 119-134):有外层 try/catch,但内部 `chrome.tabs.query({ url: url })` 仍可能抛错被外层吞掉 — 不会"无声失败"但不能精确区分 query vs create 失败。**建议:按 openTab 同样模式加固**。
- `background/focus.js` 的 `getAllOpenTabs`(line 67-117):主动过滤 chrome:// tab,所以不会查 chrome:// URL,但**没有 try/catch**,如果将来过滤规则变化可能引入 bug。
- `modules/timeline/view.js` 多处调 openTab(line 95, 140, 339, 467, 599, 691):触发的是已存储的 tab.url,理论上含 chrome:// 概率低,但 `openGroup` 已加固所以 OK。
- `modules/group/view.js:333` 同 timeline。

## 验证

1. 重载扩展(chrome://extensions → TabBoard 刷新按钮)
2. Alt+Shift+S → 输入 `> 设置` → 回车 → chrome://settings 应打开
3. 输入 `> flags` → 回车 → 应打开 Edge flags
4. 输入普通搜索 → 回车 → 普通 tab 切换不受影响
5. 故意制造失败(如 group 里保存 chrome:// URL,再 openGroup)→ 应有 toast 提示具体原因,而不是无声失败