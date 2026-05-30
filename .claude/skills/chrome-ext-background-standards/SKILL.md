---
name: chrome-ext-background-standards
description: 为 Chrome 扩展的 background 模块编写防腐蚀规范
---

# Chrome Extension Background 模块规范生成器

## 触发场景

- 开始一个 Chrome 扩展的 background 模块开发
- Code review 时发现模块边界混乱
- 需要建立团队统一的 background 开发规范

## 核心流程

### 1. 模块职责梳理

读取 `background/` 目录下的所有 `.js` 文件，分析每个模块的：

| 分析项 | 说明 |
|--------|------|
| 导出的函数 | 确认模块提供了什么能力 |
| 导入的依赖 | 发现跨模块耦合 |
| `chrome.runtime.onMessage` 监听器 | 确认处理了哪些 action |
| 直接调用其他模块函数 | 发现跨模块直接调用（违规） |

**输出格式：**

```markdown
## 模块职责矩阵

| 模块 | 职责 | 导出的函数 | 依赖模块 |
|------|------|----------|---------|
| index.js | 初始化入口 | initialize, setupListeners | all |
| commands.js | 快捷键分发 | initCommands | groups, timeline |
| ... | ... | ... | ... |
```

### 2. 消息协议审计

检查所有 `setupXxxListeners` 中的 `switch(request.action)`：

**必须检查：**

- [ ] 每个 action 有且只有一个模块处理
- [ ] `default` case 返回 `false`
- [ ] 异步响应返回 `true`
- [ ] 错误被 try-catch 包裹

**违规模式：**

```javascript
// ❌ 缺少 default
switch (request.action) {
  case 'action1': ...
}

// ❌ default 没有 return false
switch (request.action) {
  case 'action1': ...
  default: sendResponse({}); // 应该 return false
}

// ❌ 异步没有返回 true
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  doAsync().then(() => sendResponse({}));
  return; // ❌ 应该是 return true
});
```

### 3. Storage 访问模式审计

**检查所有 `chrome.storage.local.get` / `set` 调用：**

```javascript
// ❌ 空对象 truthy 问题
const result = await chrome.storage.local.get(['recordingState']);
if (result.recordingState) { // {} 也是 truthy!
  // ...
}

// ✅ 使用 'in' 检查
const result = await chrome.storage.local.get(['recordingState']);
const recordingState = ('recordingState' in result) ? result.recordingState : null;
```

**必须使用 `'in'` 检查的 key：**
- 对象类型：`recordingState`
- 数组类型：`recordings`, `videoGroups`, `groups`, `tabs`

**批量写入检查：**

```javascript
// ❌ 分开多次写入
await chrome.storage.local.set({ key1: value1 });
await chrome.storage.local.set({ key2: value2 });

// ✅ 合并一次写入
await chrome.storage.local.set({ key1: value1, key2: value2 });
```

### 4. 工具函数复用检查

以下函数/常量**只允许在 `utils.js` 中定义一次**：

| 名称 | 用途 |
|------|------|
| `generateId()` | 生成唯一 ID |
| `showToast()` | 显示 toast 消息 |
| `isSpecialPage()` | 判断特殊页面 |
| `normalizeUrl()` | URL 规范化 |
| `DEFAULT_COLORS` | 默认颜色数组 |

**检查方式：** 用 Grep 搜索这些函数/常量在各模块中的定义数量。

```powershell
# 检查 generateId 定义次数
grep -r "function generateId" background/

# 检查 isSpecialPage 定义
grep -r "isSpecialPage\|startsWith.*chrome://" background/
```

### 5. 重复代码检测

用 Grep 检测以下模式的出现次数：

| 模式 | 应该出现次数 |
|------|-------------|
| `chrome.storage.local.get(['groups'])` | 多个模块，但定义应统一 |
| `openTabboard` 函数体 | 只能 1 次（在 utils.js） |
| `SPECIAL_PROTOCOLS` / `chrome://` 判断 | 多次说明未复用 |

### 6. 规范文档生成

基于以上分析，生成 `BACKGROUND_STANDARDS.md`：

```markdown
# {项目名} Background 模块规范

## 1. 架构原则

### 1.1 模块职责边界
| 模块 | 职责 | 禁止混入 |
|------|------|---------|
| index.js | 初始化入口 | 业务逻辑 |
| commands.js | 命令分发 | 业务实现 |

### 1.2 跨模块调用规则
- ✅ 通过 chrome.runtime.sendMessage 通信
- ✅ 通过 index.js 重新导出
- ❌ 直接调用其他模块函数

## 2. 消息协议
...

## 3. Storage 访问
...

## 4. 数据限制
...
```

---

## 错误案例警示

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 在多个模块中定义 `openTabboard` | 维护困难，行为不一致 | 移到 utils.js，各模块导入 |
| 用 `if (result.key)` 判断对象是否存在 | 空对象 `{}` 是 truthy，导致跳过 | 用 `'key' in result` |
| 异步响应不返回 `true` | 消息处理函数在 Promise 完成前就结束 | 返回 `true` 表示异步 |
| `switch` 缺少 `default` | 新 action 被静默忽略 | `default: return false` |
| 跳过直接读取 background 模块 | 凭空制定规范，与实际不符 | 先完整阅读所有模块 |

## 成功标准检查清单

- [ ] 读取了 background 目录下**所有** `.js` 文件
- [ ] 识别了每个模块的 `setupXxxListeners`
- [ ] 检查了 Storage 访问是否使用 `'in'` 检查
- [ ] 确认了工具函数只在 utils.js 中定义一次
- [ ] 发现了具体违规代码位置
- [ ] 规范文档包含可执行的规则（不是空话）
