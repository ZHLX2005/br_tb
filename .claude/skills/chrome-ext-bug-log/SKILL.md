---
name: chrome-ext-bug-log
description: 记录 Chrome 扩展开发中的 bug 修复案例 - 根因、修复、教训、可复用诊断模式。当用户说"记一下这个 bug"、"保存这次修复"、"bug-log"、"为这个 bug 建档"、"沉淀这次调试"时触发。聚焦 Chrome 扩展特有陷阱 (chrome.* API 行为、Manifest V3 限制、content script 与 background 通信等),而非通用 JS bug。
---

# Chrome Extension Bug Log

结构化记录 Chrome 扩展调试中遇到的根因、修复方案、可复用模式。**单一文档一主题:bug 案例档案库**。每个具体 bug 作为独立 ref 文档,主 SKILL.md 承担索引 + 诊断模式总结。

## 何时触发

| 用户说法 | 触发动作 |
|---|---|
| "记一下这个 bug"、"保存这次修复" | 在 `references/` 下新建 `<日期>-<症状简述>.md` |
| "查一下 XX bug 之前怎么修的" | 读对应 ref 文档 |
| "这个 bug 类似 XX 吗" | 用主文档的诊断模式对比 |

## 主文档定位

- **不**:罗列每个 bug 的细节(放 ref)
- **做**:沉淀跨案例的**通用诊断模式**、**Chrome API 行为陷阱速查**、**修复前必问的检查项**
- **做**:维护 ref 索引表,告诉用户什么 bug 走哪个 ref

## Chrome 扩展特有诊断模式

### 模式 1:chrome.* API 对受限 URL 抛错 vs 返回空

`chrome://`、`edge://`、`chrome-extension://`、`about:`、`devtools://`、`file://` 在 `chrome.tabs.query({url})` 等 API 中**通常会抛错**而非返回空数组。代码必须有外层 try/catch。

快速判断:
- 看到 `chrome.tabs.query` / `chrome.tabs.create` 涉及动态 URL,先问"URL 是不是受限协议"
- 受限 URL → try/catch 包住 query,fallback 到 create
- create 也可能失败 → 单独 try/catch + 返回 `{success: false, error}`

详细案例:[[2026-07-07-system-page-open-failure]]

### 模式 2:Content script 失败"无声"

content script 调 `chrome.runtime.sendMessage`,如果 background 端 sendResponse 永远不调用(content script 拿不到 response),且没有 UI 反馈,用户**完全看不到失败**。Console 里有 lastError 但用户不查 console。

修复三件套:
1. background 端每个 async handler 必有外层 try/catch + sendResponse
2. content script 端检查 `chrome.runtime.lastError` + `response.success`
3. 失败时显示 toast/UI(不要只 console.warn)

### 模式 3:URL 拼接双斜杠陷阱

字符串拼接 `'chrome:' + '/settings'` 产出 `chrome:/settings` (单斜杠)。Chrome 通常容错,Edge 某些版本会拒。**永远用 `'chrome://' + path.replace(/^\/+/, '')`**。

### 模式 4:Service worker 链路中断

MV3 service worker 中,await reject 若未被 catch,导致后续 await 不执行 → sendResponse 不调用 → content script 端 channel 关闭 → 用户无任何反馈。

防御:
- listener 入口 try/catch + sendResponse({success:false, error})
- content script 端不能假设"调了 background 就一定有响应"

## 修复前必问的检查项

排查 Chrome 扩展 bug 时按顺序问:

1. **入口在哪**?content script 触发 / popup 触发 / 快捷键触发 / 自动触发?
2. **消息链路完整吗**?content → background → storage / chrome.* API,每个 await 都被 await 了吗?
3. **有 try/catch 吗**?尤其是 query / create / storage / message 这种可能抛错的 API。
4. **URL 是不是受限协议**?chrome://、edge://、file://、about:、devtools://、chrome-extension://?
5. **有 UI 反馈吗**?失败时用户在界面能看到什么?只 console.warn 不够。
6. **sendResponse 调用了吗**?忘了调用 = channel 关闭 + content 端 lastError。
7. **MV3 限制**?user gesture 要求 / service worker 生命周期 / host_permissions 缺失?

## Ref 索引

| ref | 何时读取 | 路径 |
|---|---|---|
| [[2026-07-07-system-page-open-failure]] | "> 系统页打不开"、openTab / openGroup 失败、chrome://、edge:// 相关报错 | references/2026-07-07-system-page-open-failure.md |

## 添加新 bug 案例的流程

1. 命名:`references/<YYYY-MM-DD>-<症状简述-kebab-case>.md`
2. 必填字段:
   - **症状**(用户报告的原文)
   - **根因**(具体代码位置 + 为什么坏)
   - **修复**(具体改动)
   - **教训**(可复用的检查项 / 反模式)
   - **影响范围**(哪些调用点有同样问题)
3. 在主文档 ref 索引表追加一行
4. 如果暴露了新模式,在主文档"诊断模式"段加一段

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---|---|---|
| 把 bug 详情全堆在主 SKILL.md | 主文档膨胀,模式总结被淹没 | 主文档只放索引 + 通用模式,具体案例放 ref |
| 修复时只改症状不复盘根因 | 下次同样 bug 仍要花同样时间排查 | 修复后必须追到根因,记录代码位置 + Chrome API 行为 |
| 只记录成功的修复 | 失败案例 / 走错方向的尝试丢失,无法避免重蹈覆辙 | 失败案例也记录,标注"试过但无效" |
| 案例描述模糊(只说"openTab 失败") | 不知道是 query 阶段还是 create 阶段 | 必须写清失败发生在链路哪一步、具体错误信息 |