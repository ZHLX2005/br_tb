# B 站观看历史模块 — 设计文档

> 模块名：`bilibili-history`
> 作者：zhaoliuxue
> 日期：2026-07-07
> 状态：草稿，待用户确认

## 1. 目标

为 TabBoard 增加一个 **B 站观看历史面板**：

- 用户粘贴一段浏览器 DevTools 导出的 cookies JSON（数组格式）
- 扩展从 JSON 里解析出 `SESSDATA` + 关键 extra_cookies（`buvid3` / `bili_jct` / `DedeUserID` / `sid`）
- 通过 background service worker 调用远程 API `http://47.110.80.47:81/api/bilibili/history/recent`（`days=3`）
- 在 TabBoard 面板渲染近 3 天历史记录的 **可读表格 + 简易可视化**

不做什么（YAGNI）：
- ❌ 不持久化到 `chrome.storage.local` —— 历史是时效数据，关闭即清
- ❌ 不实现 cookies 编辑器、自动注入、`chrome.cookies` API
- ❌ 不引入图表库（ECharts / D3 等）—— 用纯 HTML/CSS 实现柱图

## 2. 架构

```
modules/bilibili-history/
  ├── index.js        # BilibiliHistoryModule（BaseModule）
  ├── view.js         # BilibiliHistoryView（DOM + 解析 + 渲染）
  └── style.css       # ≤500 行

background/bilibili-history.js   # fetch + chrome.runtime.onMessage

manifest.json                    # +host_permissions、+background modules
modules/tabboard/tabboard.js     # +import + switchView 分支
modules/tabboard/tabboard.html   # +nav 按钮 + 视图容器 +CSS 引入
```

### 数据流

```
[用户在 textarea 粘贴 cookies JSON]
        │
        ▼  parseCookies(jsonArray) → { sessdata, extra_cookies }
BiliHistoryView.requestFetch(payload)
        │
        │ chrome.runtime.sendMessage({ action:'bilibiliHistory/fetch', payload })
        ▼
background/bilibili-history.js
   ├── 从 extra_cookies 中清理 SESSDATA 段（防双注入）
   ├── fetch('http://47.110.80.47:81/api/bilibili/history/recent', {POST, payload})
   ├── 校验 HTTP 401 / 422 / 502 / 500
   └── sendResponse({ success, data }) or { success:false, detail }
        │
        ▼
view.js 收到响应 → 渲染表格 + 柱图
```

## 3. 接口契约

### 3.1 前端 → background（chrome.runtime.sendMessage）

**请求**：
```javascript
{
  action: 'bilibiliHistory/fetch',
  payload: {
    sessdata: '...',           // URL 编码原值
    extra_cookies: 'buvid3=...; bili_jct=...; DedeUserID=...; sid=...',
    days: 3,                   // 固定 3 天
    business: 'all',
    max_pages: 5               // 估算上限，3 天 ≈ 30-90 条
  }
}
```

**响应**：
```javascript
// 成功
{ success: true, data: HistoryResponse }  // 字段见原 API 文档第 2 节
// 失败
{ success: false, detail: '...', code: 401|422|502|500 }
```

### 3.2 关键字段映射（已验证）

| API 字段 | UI 用途 |
|---|---|
| `view_at_iso` | 表格「时间」列（YYYY-MM-DD HH:mm） |
| `title` | 表格「标题」列 |
| `author_name` | 表格「UP 主」列（缺省则显 `unknown`） |
| `tag_name` / `show_title` | 「分区」列：优先 `tag_name`，否则用 `business` |
| `progress` / `duration` | 「进度」列：`progress/duration` 比值 + 百分比；`duration==0` 显 `—` |
| `tag_name` 聚合 | 「分类分布」柱图：top 6 tag，按 count 降序 |
| `business` | 「业务分布」芯片条：`archive` / `cheese` / `pgc` / `article` 计数 |
| `view_at` 按 local day 分组 | 「每日观看量」迷你柱图（最近 3 天 × 24h） |

### 3.3 UI 元素（决策已定：「表格 + 简易柱图」）

```
┌──────────────────────────────────────────────────────────────┐
│  📊 B 站近 3 天         [打开 B 站]      [🔄 重新拉取]        │
├──────────────────────────────────────────────────────────────┤
│  [首次打开：cookies 输入区]                                    │
│   <textarea placeholder="从 DevTools 复制 cookie JSON 粘贴此">  │
│   [✓ 解析并拉取]                                              │
├──────────────────────────────────────────────────────────────┤
│  [已加载状态]                                                  │
│   ·  90 个视频  ·  人文历史 24  音乐 18  手工 12 …            │
│                                                              │
│   时间分布 (最近 3 天 × 24h)                                   │
│   ▓▓░▓▓▓░░░ ░░░▓▓▓░░ ▓▓▓▓▓▓░░ (CSS div 柱)                   │
│                                                              │
│   分区 TOP 6（横向柱图）                                       │
│   人文历史 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 24                            │
│   音乐现场 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 18                                │
│   手工     ▓▓▓▓▓▓▓▓▓▓ 12                                       │
│                                                              │
│   表格（按 view_at 倒序）                                      │
│   ┌────────────────┬──────────────┬──────┬──────┬─────┐       │
│   │ 时间           │ 标题         │ UP 主│ 时长 │ 分区│       │
│   ├────────────────┼──────────────┼──────┼──────┼─────┤       │
│   │ 07-07 06:22    │ 为什么其他…  │ 哦…  │ 0:46 │ 人文│       │
│   └────────────────┴──────────────┴──────┴──────┴─────┘       │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 模块接口（沿用 BaseModule 模式）

```javascript
class BilibiliHistoryModule {
  constructor(container, dataManager, eventBus)
  init()
  render(data)              // 总是渲染初始空状态，等待用户输入
  bindEvents()
  destroy()
}
```

**重要**：本模块**不依赖** `chrome.storage` —— `render(data)` 中传入的 `data` 完全不用。原因：历史是按需数据，不进存储。

## 4. 错误处理

| 场景 | UI 反馈 | background 行为 |
|---|---|---|
| 用户粘贴空 / 非数组 JSON | 显示「请粘贴有效的 cookies JSON」红字 | 不发请求 |
| 缺少 `SESSDATA` 字段 | 同上 | 不发请求 |
| HTTP 401（-101 失效）| 顶部红条：`SESSDATA 失效（-101），请重新登录 B 站` | 按原样转发 |
| HTTP 422（参数校验失败）| 红条显示 FastAPI 返回的 detail | 同上 |
| HTTP 502（B 站错误）| 红条显示 code/message | 同上 |
| 网络超时 / 0 状态 | 红条：`网络异常：<err.message>`（可点重试）| 同上 |
| CORS / DNS 错误 | 同上 | 同上 |
| 后端非 JSON 返回 | 同上 | 同上 |

## 5. 安全

- **SESSDATA 不落 chrome.storage、不进 chrome.storage.session、不进 localStorage** — 只在 view 闭包内 in-memory
- **不写日志**：console.warn/error 不打印 SESSDATA 原值，只打印 `***masked***`
- **不写 URL/tab 个人数据**：仅记录 `code + 行数 + 耗时`
- 关闭 TabBoard tab 后，cookies JSON 仅在 textarea 的 input value 中（用户离开即被 DOM GC）

## 6. 改动清单

### 6.1 新增

- `modules/bilibili-history/index.js` (~35 行)
- `modules/bilibili-history/view.js` (~400 行，含 JSON 解析 / 表格 / 柱图)
- `modules/bilibili-history/style.css` (~350 行，纯 HTML/CSS 柱图)
- `background/bilibili-history.js` (~50 行，fetch + error wrapping)

### 6.2 修改

- `manifest.json`：
  - `host_permissions`: 加 `"http://47.110.80.47/*"`
  - `permissions`: 不动（`storage` 已存在）
- `modules/tabboard/tabboard.html`：
  - 加 `<link rel="stylesheet" href="../bilibili-history/style.css">`
  - 加 `<button id="bilibiliHistoryViewBtn" class="nav-btn" title="B 站历史">Bili</button>`
  - 加 `<div id="bilibiliHistoryView" class="view-container" style="display: none;"><div id="bilibiliHistoryPanel"></div></div>`
- `modules/tabboard/tabboard.js`：
  - 加 `import BilibiliHistoryModule from '../bilibili-history/index.js';`
  - 在 `_setupViewSwitchButtons()` 加按钮监听
  - 在 `switchView` 加 `case 'bilibili-history': ...` 分支
  - 在 `_updateViewUI()` 加 active 状态切换 + display 切换
- `background/index.js`：
  - 加 `import { setupBiliHistoryListeners } from './bilibili-history.js';`
  - 加 `setupBiliHistoryListeners();`

### 6.3 不改

- `DataManager.js`：本模块不需存储
- `init.js`：本模块不需初始化 storage key
- `modules/shared/*`：无影响

## 7. 测试策略

### 7.1 不写自动化测试

理由：API 跨域 + 真实 cookie，难 mock。改用 **手动烟测**：

1. **加载扩展** → 打开 TabBoard 页面
2. **预期**：顶部 nav 多一个 **Bili** 按钮（点击可切换面板）
3. **预期**：默认显示输入区（无 cookies 状态）
4. **操作**：粘贴用户提供的 cookies JSON → 点「解析并拉取」
5. **预期**：~1s 内展示 3 天 × ~30 条数据，含表格 + 柱图
6. **降级**：故意去掉 SESSDATA 段 → 应红条 `请粘贴有效的 cookies JSON`
7. **降级**：故意把 `days` 设成 100 → 422 错误应正确显示

### 7.2 验收要点

- [ ] Bili 按钮在 6 个现有按钮之后
- [ ] 切换 view 后 `#stats` 不残留旧文本（虽然本模块不持久数据，但 `render()` 仍需更新 stats）
- [ ] CSS 文件 ≤500 行
- [ ] 不引入第三方库（无 `<script src="...echarts...">`）
- [ ] 实际打开 DevTools Network，确认 background fetch 命中 `:81` 端口

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 后端 CORS 不开 | background fetch 跨域失败 | manifest 加 host_permissions；如仍失败，转为 view.js fetch 并配 nginx CORS（本期不管） |
| 用户 cookie 失效 | 一拉就 401 | 红条提示；可重新粘贴 |
| 后端 47.110.80.47:81 不可达 | UI 红条 | 红条+重试按钮 |
| API 字段名变更 | 渲染崩 | view.js 渲染前做防御性取值（`item.title ?? '—'`） |

