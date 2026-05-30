---
name: chrome-ext-popup-standards
description: 分析 Chrome 扩展 popup 目录，生成防腐蚀规范 skill
---
# Chrome Extension Popup 模块规范生成器

调用 /writing-skills 或 /skill-creator 获得 skill 规范。

如果两个skill无法发现  立刻警告用户 

给出 bad_example 和 good_eg 的正反案例。

## 触发场景

- "分析 popup 目录，生成规范"
- "防止 popup 模块腐蚀"
- 开始 popup 模块开发时建立规范

## 核心流程

### Step 1: 读取目录结构

```powershell
# 获取所有源文件
ls -File popup/

# 查看文件树（含行数）
Get-ChildItem popup -Recurse -File | Select-Object FullName, @{N='Lines';E={(Get-Content $_.FullName | Measure-Object -Line).Lines}}
```

**分析维度：**

| 维度     | 说明                             |
| -------- | -------------------------------- |
| 文件数量 | 判断模块复杂度                   |
| 文件大小 | 找出过于臃肿的文件（>300行标记） |
| 命名模式 | 识别模块划分（modules/ 子目录）  |

### Step 2: 模块依赖分析

对每个 `.js` 文件提取 `import ... from`：

```javascript
// popup.js 导入分析
import { loadGroups } from './modules/groups.js';
import { loadSettings } from './modules/settings.js';

// videoProgress.js（跨目录导入 - 需标记）
import { normalizeUrl } from '../../background/utils.js';
import { getVideoDisplayProgress } from '../../modules/video-progress/progress-utils.js';
```

**生成依赖矩阵：**

```markdown
## 模块依赖矩阵

| 文件 | 导入模块 | 跨目录导入 | 行数 | 状态 |
|------|---------|----------|------|------|
| popup.js | 8个modules | 无 | 270 | ✅ |
| groups.js | utils.js | 无 | 160 | ✅ |
| videoProgress.js | utils, background/utils | ⚠️ 是 | 391 | ⚠️ 过大 |
```

### Step 3: 代码异味识别

#### 3.1 重复函数检测

```powershell
# 查找重复的 formatDuration
grep -rn "function formatDuration" popup/

# 查找重复的 DEFAULT_COLORS
grep -rn "const DEFAULT_COLORS" popup/

# 查找所有 DOMContentLoaded（多入口问题）
grep -rn "DOMContentLoaded" popup/*.js popup/modules/*.js
```

#### 3.2 文件大小检查

```powershell
# 超过 300 行的文件
foreach ($f in Get-ChildItem popup -Recurse -Filter "*.js") {
  $lines = (Get-Content $f | Measure-Object -Line).Lines
  if ($lines -gt 300) {
    Write-Host "⚠️  $($f.FullName): $lines 行"
  }
}
```

#### 3.3 入口点检查

多个 `DOMContentLoaded` 是入口点混乱的标志：

```javascript
// popup.js - 正确
document.addEventListener('DOMContentLoaded', init);

// popup-solution.js - 错误：独立入口
document.addEventListener('DOMContentLoaded', () => {
  popupSolution.init();
});
```

### Step 4: 规范 Skill 文件生成

**输出位置：** `.claude/skills/chrome-ext-popup-standards/SKILL.md`

```markdown
# {项目名} Popup 模块规范

## 1. 模块职责边界

| 模块 | 职责 | 禁止混入 |
|------|------|---------|
| popup.js | 主入口、组装模块 | 业务逻辑 |
| groups.js | 分组列表 UI | 设置管理 |
| utils.js | 工具函数 | 业务逻辑 |
```

---

## 反正面案例 (bad_example / good_eg)

### 案例 1: 重复函数定义

#### bad_example

```javascript
// videoProgress.js:381
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// videoCapture.js:177 - 同样的函数又定义一次
function formatDuration(seconds) {
  // ... 完全相同的代码
}
```

#### good_eg

```javascript
// popup/modules/utils.js - 定义一次
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// videoProgress.js - 导入使用
import { formatDuration } from './utils.js';

// videoCapture.js - 同样导入
import { formatDuration } from './utils.js';
```

---

### 案例 2: 多入口点

#### bad_example

```javascript
// popup.js
document.addEventListener('DOMContentLoaded', init);

// popup-solution.js - 独立入口，造成初始化顺序不确定
document.addEventListener('DOMContentLoaded', () => {
  popupSolution.init();
});
```

#### good_eg

```javascript
// popup.js - 统一入口
import { PopupSolution } from './popup-solution.js';

async function init() {
  const solution = new PopupSolution();
  await solution.init();
}

document.addEventListener('DOMContentLoaded', init);

// popup-solution.js - 只导出类，不自己监听 DOMContentLoaded
export class PopupSolution {
  async init() { ... }
}
```

---

### 案例 3: 工具函数重复定义

#### bad_example

```javascript
// popup/modules/groups.js:8 - 重复定义
const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

// background/utils.js:6 - 已定义过一次
export const DEFAULT_COLORS = [...];
```

#### good_eg

```javascript
// background/utils.js - 唯一定义
export const DEFAULT_COLORS = [...];

// popup/modules/groups.js - 直接导入
import { DEFAULT_COLORS } from '../../background/utils.js';

// 删除本地重复定义
```

---

### 案例 4: 跨目录业务导入

#### bad_example

```javascript
// popup/modules/videoProgress.js
import { loadGroups } from '../background/groups.js'; // ❌ 业务逻辑禁止跨目录
```

#### good_eg

```javascript
// popup/modules/videoProgress.js
// ✅ 工具函数允许跨目录
import { normalizeUrl } from '../../background/utils.js';
import { getVideoDisplayProgress } from '../../modules/video-progress/progress-utils.js';

// ✅ 业务逻辑通过消息传递
const response = await chrome.runtime.sendMessage({ action: 'getGroups' });
```

---

## 决策树

```
分析 popup 目录
    │
    ├─► 多个 DOMContentLoaded？
    │       └─► 统一入口 → 合并到 popup.js
    │
    ├─► formatDuration 重复定义？
    │       └─► 移到 popup/modules/utils.js
    │
    ├─► DEFAULT_COLORS 重复定义？
    │       └─► 从 background/utils.js 导入
    │
    ├─► 有超过 300 行的文件？
    │       └─► 标记并建议拆分（渲染 vs 数据处理）
    │
    └─► 跨目录导入业务模块？
            └─► 改为 chrome.runtime.sendMessage
```

---

## 错误案例警示

| 错误操作                | 实际后果                              | 正确做法                  |
| ----------------------- | ------------------------------------- | ------------------------- |
| 两个 DOMContentLoaded   | 初始化顺序不确定，可能导致竞态        | 统一入口由 popup.js 调用  |
| formatDuration 多处定义 | 修改时漏改，造成不一致                | 统一在 utils.js           |
| 允许跨目录业务导入      | 模块耦合增加，background 难以独立维护 | 只允许工具跨目录          |
| 文件超过 300 行不拆     | 难以维护，Code Review 困难            | 按职责拆分为渲染+数据处理 |

## 成功标准检查清单

- [ ] 读取了 popup 目录下**所有** `.js` 文件
- [ ] 生成了模块依赖矩阵
- [ ] 检测了 `formatDuration` 重复定义
- [ ] 检测了 `DEFAULT_COLORS` 重复定义
- [ ] 检查了 DOMContentLoaded 入口数量
- [ ] 检测了跨目录导入是否合理（工具 vs 业务）
- [ ] 生成了 `.claude/skills/chrome-ext-popup-standards/SKILL.md`
- [ ] 给出了正反案例（bad_example / good_eg）
