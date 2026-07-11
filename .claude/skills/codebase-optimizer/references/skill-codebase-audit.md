# Skill-Codebase Audit — 技能与代码库一致性审计（语言无关）

> **定位：** 检查 `.claude/skills/` 下每个 skill 的 SKILL.md 是否真实反映代码库现状。
> **触发：** 代码库重构后、skill 内容有明显错误、用户说"这个 skill 说的不对"时读取本 ref。
> **输出：** 每个 skill 的审计报告 + 修复清单。

---

## 1. 审计工作流

```
1. 列出 .claude/skills/ 下所有 skill
2. 对每个 skill：
   a. 提取所有文件路径引用
   b. 提取所有类名/结构体名/函数名引用
   c. 提取所有 import/引用路径
   d. 在代码库中验证每项是否存在
3. 生成审计报告（存在/不存在/已改名）
4. 列出修复项（按严重程度排序）
```

---

## 2. 审计项详解（语言无关）

### 2.1 文件路径审计

```bash
# 从 SKILL.md 提取所有文件路径引用（适用于任何扩展名）
grep -oP '[\w/.\-]+\.[a-z]+' .claude/skills/<skill>/SKILL.md

# 验证每个路径是否存在
grep -oP '[\w/.\-]+\.[a-z]+' .claude/skills/<skill>/SKILL.md | while read f; do
  [ -f "$f" ] && echo "✅ $f" || echo "❌ $f"
done
```

### 2.2 import/引用路径审计

```bash
# 从源文件所在目录解析相对路径到目标文件，验证存在性
# 如果环境有 Node.js：
node -e "
  const p = require('path'), fs = require('fs');
  const srcFile = 'path/to/source.py';
  const importPath = '../../some/module.py';
  const resolved = p.resolve(p.dirname(srcFile), importPath);
  console.log(resolved, fs.existsSync(resolved));
"

# 如果环境有 Python（等价）：
python -c "
  import os.path
  src = 'path/to/source.py'
  imp = '../../some/module.py'
  resolved = os.path.normpath(os.path.join(os.path.dirname(src), imp))
  print(resolved, os.path.exists(resolved))
"
```

### 2.3 类/结构体/接口名审计

适配目标语言的关键字：

```bash
# JS/TS/Python/Java: class
grep -rn "class ClassName" --include="*.js" --include="*.ts" --include="*.py" --include="*.java"

# Go: struct
grep -rn "struct StructName" --include="*.go"

# Rust: struct / impl
grep -rn "struct StructName\b" --include="*.rs"

# Python: class or def
grep -rn "def function_name" --include="*.py"
```

### 2.4 模块目录审计

```bash
# 检查模块目录是否存在
test -d "path/to/module/" && echo "✅" || echo "❌"
```

---

## 3. 修复优先级

| 优先级 | 修复类型 | 处理方式 |
|--------|---------|---------|
| 🔴 P0 | 假引用（引用不存在的文件/类） | 修正路径；如果目标已删除则删除该节 |
| 🟡 P1 | 过时描述（描述的函数/接口已重构） | 更新描述匹配当前代码 |
| 🟢 P2 | 遗漏重要细节 | 补充遗漏的模式 |
| ⚪ P3 | 可选的优化 | 按意愿决定 |

---

## 4. 常见坑点

| 坑 | 表现 | 预防 |
|----|------|------|
| import 路径数错层级 | 相对路径解析到不存在的文件 | 写完后用 `node -e` 或 `python -c` 验证目标存在 |
| 类名大小写不匹配 | skill 写 `class userModel` 但实际是 `class UserModel` | grep 时加 `-i` 或逐个大小写检查 |
| 文件被移动而非删除 | `test -f` 返回假，但 grep 能在别处找到 | 先用 grep 全局搜文件名再决定删除还是改路径 |
| 语言关键字混淆 | 用 `class` 搜 Go 代码（Go 是 `struct`） | 根据目标语言调整 grep 关键字 |
