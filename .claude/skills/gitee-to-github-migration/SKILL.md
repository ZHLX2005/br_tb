---
name: gitee-to-github-migration
description: 将项目从 Gitee 迁移到 GitHub 的完整指南，包含错误案例和最佳实践
type: reference
---

# Gitee → GitHub 迁移指南

## 快速命令

```bash
# 1. 检查 GitHub CLI 登录状态
gh auth status

# 2. 查看当前远程
git remote -v

# 3. 删除所有远程（注意拼写 orgin 和 origin 都要删）
git remote remove origin
git remote remove orgin

# 4. 创建 GitHub 仓库并推送
gh repo create <repo-name> --public --source=. --push
```

## 完整流程

### 步骤 1: 验证 GitHub CLI

```bash
gh auth status
```

预期输出包含：
- `Logged in to github.com`
- `Active account: true`
- `Git operations protocol: ssh`

如果未登录：`gh auth login`

### 步骤 2: 分析当前状态

```bash
git remote -v
```

常见情况：

| 情况 | 命令 |
|------|------|
| 正常 origin | `git remote remove origin` |
| 拼写错误 orgin | `git remote remove orgin` |
| 两个都存在 | `git remote remove origin && git remote remove orgin` |
| 自定义名称 | `git remote remove <name>` |

### 步骤 3: 删除 Gitee 远程

**重要**：Gitee 远程可能拼写错误为 `orgin`（少一个 i），必须单独检查并删除。

```bash
# 删除所有远程
git remote remove origin
git remote remove orgin

# 确认已删除
git remote -v
# 应该无输出
```

### 步骤 4: 创建 GitHub 仓库

**方式 A**：一条命令完成（推荐）

```bash
gh repo create <repo-name> --public --source=. --push
```

**方式 B**：分步操作

```bash
# 创建空仓库
gh repo create <repo-name> --public

# 添加远程
git remote add origin git@github.com:<username>/<repo-name>.git

# 推送
git push -u origin main
```

### 步骤 5: 验证结果

```bash
git remote -v
# 应显示: origin  git@github.com:<username>/<repo-name>.git (fetch/push)

git status
# 应显示: Your branch is up to date with 'origin/main'.
```

## 错误案例

### 案例 1: "cannot lock ref 'refs/heads/main'"

**原因**：GitHub 上已存在同名仓库且有初始提交

**错误输出**：
```
! [remote rejected] main -> main (cannot lock ref 'refs/heads/main': reference already exists)
error: failed to push some refs to 'github.com:<username>/<repo-name>.git'
```

**解决方案**：
```bash
git push -u origin main --force
```

⚠️ **警告**：强制推送会覆盖 GitHub 上现有内容，确认仓库内容可以覆盖后再执行。

### 案例 2: 拼写错误 "orgin" 导致残留

**原因**：Gitee 远程被命名为 `orgin`（缺少字母 i）

**现象**：`git remote -v` 显示 `orgin`，执行 `git remote remove origin` 无效

**解决方案**：
```bash
git remote remove orgin
```

### 案例 3: 多个远程残留

**原因**：同时存在 `origin` (GitHub) 和 `orgin` (Gitee)

**现象**：`git remote -v` 显示两个远程

**解决方案**：
```bash
git remote remove origin
git remote remove orgin
git remote add origin git@github.com:<username>/<repo-name>.git
```

### 案例 4: 仓库已存在

**原因**：用 `--source=. --push` 但仓库已存在

**解决方案**：改用分步操作
```bash
gh repo create <repo-name> --public
git remote add origin git@github.com:<username>/<repo-name>.git
git push -u origin main
```

## 变量说明

| 变量 | 替换为 |
|------|--------|
| `<repo-name>` | 仓库名，如 `br_ct` |
| `<username>` | GitHub 用户名，如 `ZHLX2005` |

## 需要保留 Gitee 作为备份？

如果需要保留 Gitee 作为备份，只添加 GitHub 作为额外远程：

```bash
# 保留现有远程，添加 GitHub
git remote add github git@github.com:<username>/<repo-name>.git

# 推送到两个远程
git push -u github main
git push -u origin main  # Gitee
```

## 验证检查清单

- [ ] `gh auth status` 显示已登录
- [ ] `git remote -v` 只显示 GitHub，不显示 Gitee
- [ ] `git remote -v` 无拼写错误残留（orgin）
- [ ] `gh repo view <repo-name>` 能看到仓库
- [ ] `git status` 显示 "up to date with 'origin/main'"

## GitHub CLI 参考

```bash
# 登录状态
gh auth status

# 登录
gh auth login

# 创建仓库
gh repo create <name> [flags]

# 查看仓库
gh repo view <name>

# 列出用户仓库
gh repo list <username> --limit 10
```

常用 flags：
- `--public` 公开仓库
- `--private` 私有仓库
- `--source=.` 使用当前目录
- `--push` 推送现有代码
