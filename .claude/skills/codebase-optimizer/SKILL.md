---
name: codebase-optimizer
description: 阅读任意代码库目录（不限语言/框架），分析模块与代码结构，生成防腐蚀规范 SKILL.md、更新已有 skill 使其与代码库一致、或在使用 skill 后反思同步项目经验。覆盖"创建"、"同步"、"反思"三个场景。不生成孤儿文档。
---
# Codebase Optimizer — 元技能：从代码库生成、同步或反思 Skill

> **这不是特定语言的规范生成器，而是一个元技能**——适用于任何技术栈（JS、Python、Go、Rust、Java 等）的任何代码库。
>
> 三个场景，一个闭环：
> **① 创建** — 为某个目录生成防腐蚀规范 skill（从 0 到 1）
> **② 同步** — 审计已有 skill 是否与代码库一致，修复假引用/死代码（从 1 到 N）
> **③ 反思** — 使用 skill 完成任务后，把项目经验、踩坑记录、新发现的模式沉淀回 skill（经验闭环）
>
> **本质就是一件事：让 skill 始终反映代码库和项目经验的真实状态。**

参考底层依赖skill: 

```
skill-creator  /writing-skills   
```

同级meta-skill : 

key_board_2/key_board_3

## 触发条件

### 创建 / 同步

- "为这个项目创建模块规范" / "分析这个目录"
- "防止代码腐蚀，生成规范 skill"
- "检查已有 skill 是否和代码一致" / "审计 skill"
- "这个 skill 说的路径/类名/方法在代码里找不到"
- "优化 skill，同步代码库"
- "检查 .claude/skills 里哪些 skill 已过时"

### 反思（使用完 skill 后）

- "把这个经验记到 skill 里"
- "根据这次使用优化一下 skill"
- "记一下这个坑，加到 skill 里"
- "做完这个功能了，更新下对应的 skill"
- "把刚才的教训沉淀到 skill"
- "保存这次调试经验"

---

## 核心原则

| 原则                     | 说明                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| **从代码出发**     | 必须完整遍历目标目录、分析依赖后再写规范，不能凭空编造           |
| **规范可执行**     | 检测标准必须给出具体命令或工具，不能写"代码要保持整洁"           |
| **不生成孤儿文档** | 每个产出物必须是`.claude/skills/<name>/SKILL.md`，能被系统发现 |
| **先同步再创建**   | 如果已有 skill 与实际代码不一致，先修复再考虑创建新 skill        |
| **用完即反思**     | 使用 skill 完成任务后，立即反思并同步经验，防止遗忘              |
| **语言无关**       | 本 skill 的分析方法适用于任何编程语言                            |

---

## 通用流程模板

无论是创建、同步还是反思，都遵循同一套底层流程：

```
1. 侦察 → 收集当前代码库状态 + 项目经验
2. 分析 → 对照已有 skill，标记差距
3. 执行 → 创建、修正或扩展 SKILL.md
4. 验证 → 确认所有引用在代码库中存在
```

下面三个场景是这套流程的具体落地。

---

## 场景一：同步已有 Skill ✨

> **何时用：** 代码库重构后、skill 内容有明显错误、或定期审计以保证 skill 不腐烂。

### Step 1: 提取 skill 中的引用

```bash
# 从 SKILL.md 中提取所有文件路径引用（适配任何扩展名）
grep -oP '[\w/.\-]+\.[a-z]+' .claude/skills/<skill>/SKILL.md | sort -u

# 提取类名/结构体名引用（适配目标语言关键字）
grep -oP '(?<=\bclass )\w+' .claude/skills/<skill>/SKILL.md | sort -u   # JS/Python/Java
grep -oP '(?<=\bstruct )\w+' .claude/skills/<skill>/SKILL.md | sort -u  # Go/Rust
grep -oP '(?<=\bfunction )\w+' .claude/skills/<skill>/SKILL.md | sort -u
grep -oP '(?<=\bdef )\w+' .claude/skills/<skill>/SKILL.md | sort -u     # Python
grep -oP '(?<=\bfn )\w+' .claude/skills/<skill>/SKILL.md | sort -u      # Rust
```

### Step 2: 逐项验证存在性

| 审计项                    | 命令（适配目标语言）                                      | 严重度                               |
| ------------------------- | --------------------------------------------------------- | ------------------------------------ |
| **文件路径**        | `test -f "<path>"`                                      | 🔴 路径不存在 → 整个 section 假引用 |
| **类/结构体/接口**  | `grep -rn "class X\|struct X\|trait X" --include="*.ext"` | 🔴 实体不存在 → 技能基础错了        |
| **函数/方法**       | `grep -rn "def X\|fn X\|function X" --include="*.ext"`    | 🟡 函数不存在 → 技能细节过时        |
| **import/引用路径** | 从源文件所在目录解析相对路径，验证目标存在                | 🟡 路径错但剩余技能可能仍可用        |
| **配置/协议字段**   | `grep '"fieldName"\|fieldName:' <config-file>`           | 🟡 数据模型/协议变更                 |
| **模块目录**        | `test -d "path/to/module/"`                             | 🟡 模块被重命名或删除                |

### Step 3: 修复偏差

| 发现类型           | 处理                                                        |
| ------------------ | ----------------------------------------------------------- |
| 路径错             | 修正为真实路径，或删除该 section                            |
| 类/方法不存在      | 更新为当前代码中的对应物                                    |
| import/引用路径错  | 从源文件目录出发，用`path.resolve()` 或物理路径验证后修正 |
| 整个模块已不存在   | 标记"已废弃"或删除该 skill                                  |
| 描述的场景不再触发 | 更新 description 字段                                       |

### Step 4: 输出审计报告

```markdown
## 审计结果：<skill-name>

| 引用 | 状态 | 修复 |
|------|------|------|
| `src/models/user.py` | ✅ 存在 | — |
| `class UserModel` | ❌ 不存在 | 更新为 `class User` |
| `../helpers/auth.py` | ❌ 解析错误 | 改为 `../../helpers/auth.py` |
```

---

## 场景二：创建新 Skill

> **何时用：** 新模块立项、发现某个目录没有对应 skill、或需要确立编码规范时。

### Step 1: 侦察——遍历目标目录

```bash
# 获取所有源文件（根据实际扩展名调整）
find <target-dir> -type f \( -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) | sort

# 文件大小排行（识别过于臃肿的文件）
find <target-dir> -type f -name "*.java" -exec wc -l {} + | sort -rn | head -20
```

**分析维度：**

| 维度          | 说明                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| 文件数量      | 判断模块复杂度                                                          |
| 文件大小      | 超过 300 行标记为过大文件（可根据语言调整阈值）                         |
| 命名模式      | 识别模块划分（`models.py` + `views.py` / `<name>.service.ts` 等） |
| import/依赖图 | 识别职责边界和耦合程度                                                  |

### Step 2: 分析——模块依赖

```bash
# 导入分析（适配目标语言的 import 语法）
# JS/TS:  import ... from '...'
# Python: import ... / from ... import ...
# Go:     import "..."
# Rust:   use ...

grep -rn "^import\|^from.*import\|^use " <target-dir>/ --include="*.py" --include="*.rs" | sort
```

**生成依赖矩阵：**

```markdown
## 依赖矩阵

| 文件 | 导入/引用的模块 | 被引用次数 | 行数 | 状态 |
|------|---------------|----------|------|------|
| main.py | config, utils | 0 | 50 | ✅ |
| config.py | (无) | 5 | 80 | ✅ |
| models.py | utils, db | 3 | 350 | ⚠️ 过大 |
```

### Step 3: 执行——输出 SKILL.md

**目录结构：**

```
.claude/skills/<模块名>/
├── SKILL.md        ← 必选
└── references/     ← 可选（仅当有独立引用价值的子主题）
```

**文件模板（语言无关）：**

```markdown
---
name: <模块名>-standards
description: <触发描述>
---

# {项目} {模块} 模块规范

## 职责边界
| 文件 | 职责 | 禁止混入 |
|------|------|---------|
| main.py | 入口/组装 | 业务逻辑 |

## 正反案例
### bad_example
[错误的代码模式]
### good_eg
[正确的代码模式]
```

### Step 4: 验证

```bash
# 验证所有引用的文件存在
grep -oP '[\w/.\-]+\.[a-z]+' .claude/skills/<name>/SKILL.md | while read f; do
  [ -f "$f" ] && echo "✅ $f" || echo "❌ $f"
done

# 验证所有引用的类/函数存在（适配语言关键字）
grep "class AClass\|struct AStruct" $(find . -name "*.py" -o -name "*.go")
```

---

## 场景三：反思同步 🔄

> **何时用：** 使用某个 skill 完成了任务后，把过程中发现的新模式、踩的坑、项目特化经验沉淀回 skill。
>
> 这是技能进化的闭环——不反思，skill 永远是初版水平。

### Step 1: 回顾使用过程

在刚刚结束的会话中回顾：

| 问题                       | 说明                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| **skill 说对了吗？** | skill 的流程/规范是否符合实际项目的代码结构？有没有过时或不准确的地方？ |
| **发现新模式了吗？** | 项目里有没有 skill 没覆盖到的新文件、新模块、新约定？                   |
| **踩坑记录**         | 刚刚的调试/开发过程中，有什么值得记下来的教训？防止下次再踩。           |
| **缺少什么？**       | 使用 skill 时，有没有感觉缺了什么信息？缺了某个文件引用？缺了某个步骤？ |
| **上下文补全**       | 有什么"只有做过这个项目才知道"的经验可以加到 skill 里？                 |

### Step 2: 定位要更新的 skill 及其 refs

```bash
# 找出与本次工作最相关的 skill
ls .claude/skills/

# 阅读目标 skill 的当前内容（SKILL.md + 所有 refs）
cat .claude/skills/<target-skill>/SKILL.md
ls .claude/skills/<target-skill>/references/ 2>/dev/null

# 确认哪些 ref 与本次经验相关
grep "\[\[" .claude/skills/<target-skill>/SKILL.md  # 列出所有 ref 链接
```

### Step 3: 执行同步

根据 Step 1 的回答，先判断影响范围：是只影响 SKILL.md，还是影响某个 ref 文档，还是两者都要改？

```bash
# 如果经验属于某个特化子主题 → 更新 references/ 下的对应文件
# 如果经验属于核心流程 → 更新 SKILL.md
# 如果既有子主题又有核心流程 → 两者都更新
```

然后执行以下一种或多种操作：

| 经验类型 | 操作 | 目标 | 示例 |
|---------|------|------|------|
| **新的架构事实** | 更新职责边界、依赖矩阵 | SKILL.md | "原来 `auth.py` 已经拆成 `auth/login.py` + `auth/session.py` 了" |
| **新踩的坑** | 追加到错误案例表 | SKILL.md 或 ref | "WebSocket 断连不会自动重连，需要在 `onClose` 里加重试逻辑" |
| **发现新模式** | 新增正反案例 | SKILL.md 或 ref | "动态注册路由要在 `app.register()` 里声明" |
| **流程改进** | 优化 skill 的步骤 | SKILL.md | "部署前要先跑 `migration`，skill 漏了这一步" |
| **ref 过时/不全** | 更新对应 ref 文档 | `references/` | "audit ref 只写了 `grep`，没写 `python -c` 等价命令" |
| **缺少特化指南** | 新建 ref 文档，加 SKILL.md 索引表 | `references/` + SKILL.md | "这个项目有特殊的部署流程，拆一个 `deployment.md` ref" |

### Step 4: 验证更新

```bash
# 验证新加的引用是否存在
test -f "新加的路径"
grep "新加的类名" --include="*.py"

# 确认 skill 仍可触发（description 完整性）
head -4 .claude/skills/<target-skill>/SKILL.md

# 如更新了 ref，验证 ref 的引用路径也正确
ls .claude/skills/<target-skill>/references/
grep "\[\[" .claude/skills/<target-skill>/SKILL.md  # ref 链接有效
```

### 反思同步的触发时机

```
完成任务后
  ├─ 发现新踩坑？ → 记入 skill 错误案例（如属特化子主题则记入对应 ref）
  ├─ 发现新模式？ → 记入 skill 正反案例（如属特化子主题则记入对应 ref）
  ├─ 发现 skill 过时？ → 立即走「场景一：同步」
  ├─ 发现 ref 过时/不全？ → 更新 ref，同步更新 SKILL.md 索引表
  ├─ 缺少独立主题的经验？ → 新建 ref，并在 SKILL.md 末尾登记
  └─ 什么都没发现 → 无需操作，但考虑在 memory 中记一条"本次未发现新经验"
```

---

## 错误案例

| 错误操作                           | 实际后果                               | 正确做法                                    |
| ---------------------------------- | -------------------------------------- | ------------------------------------------- |
| 生成独立的 .md 文档而非 SKILL.md   | 文档无法被系统发现，成为孤儿           | 只产出`.claude/skills/<name>/SKILL.md`    |
| 不读代码就写规范                   | 规范与实际脱节                         | 先完整遍历目录                              |
| 规范太宽泛（"代码要保持整洁"）     | 无法执行                               | 给出具体检测命令和阈值                      |
| 只看文件名判断职责                 | 误判模块边界                           | 分析 import/依赖图                          |
| 写死语言特定语法                   | 该 skill 无法复用于其他项目            | 保持语言无关，或通过 references/ 分语言变体 |
| 生成后不验证引用路径               | 用户运行时踩坑                         | 用`test -f` 或 `path` 解析工具验证      |
| 在两个 skill 中定义相同规则        | 规则冲突，用户困惑                     | 规则唯一定义在归属最近的 skill 中           |
| 忘了这是个元技能，写成特定框架指南 | 其他项目无法使用                       | 锚定"从代码出发"原则，不写死框架名          |
| **用完不反思**               | skill 永远停留在初版，积累不了项目经验 | 每次使用 skill 后，花 2 分钟反思（场景三）  |

---

## 验证清单

- [ ] 读取了目标目录**所有**源文件
- [ ] 生成了模块依赖矩阵
- [ ] 识别了代码异味（过大文件、重复代码、职责混杂）
- [ ] 规范包含**可执行**的检测方式
- [ ] 只产出 `.claude/skills/<name>/SKILL.md`
- [ ] 给出了正反案例（bad_example / good_eg）
- [ ] **同步场景**验证了所有引用的文件/类/方法存在
- [ ] **创建场景**验证了所有 import/引用路径正确
- [ ] **反思场景**记录了本次使用中发现的新经验
- [ ] 不存在两个 skill 定义相同规则
- [ ] 内容不绑定特定语言/框架（纯元技能视角）
- [ ] 错误案例表中包含了反思同步发现的踩坑

---

## 进一步优化

创建、同步或反思完 skill 后，调用 `skill-creator` 做两件事：

1. **测试用例** — 编写 2-3 个真实用户输入，验证 skill 能正确触发
2. **描述优化** — 优化 description 字段，提高触发精度

> 如果 `skill-creator` 不可用，直接退回本 skill 的基本原则即可。

---

## References

| Ref | 何时读取                               | 路径                               |
| --- | -------------------------------------- | ---------------------------------- |
| [[skill-codebase-audit]]    | 需要按部就班做深度审计时（含详细脚本） | references/skill-codebase-audit.md |
