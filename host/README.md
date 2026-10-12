# @tabboard/host

TabBoard 的 native host + 本地数据湖，单 Node entry 双 transport（Chrome stdio + CLI argv）。

## 状态

Phase 1：核心骨架（5 个命令 + 双 transport + Windows 注册表自写）。

## 安装（开发期）

```bash
cd host
npm link          # 把 @tabboard/host 注册到全局 node_modules
npx tabboard --help
```

## 数据湖位置

- `~/.tabboard/lake/*.jsonl` — 各域 append-only 数据
- `~/.tabboard/skills/` — 仿 nx-tb 的 skill 源
- `~/.tabboard/host.manifest.json` — Chrome native messaging manifest 锚点
- `~/.tabboard/state/last_backup.json` — 同步元信息

可被 `TABBOARD_LAKE_DIR` / `TABBOARD_SKILLS_DIR` 环境变量覆盖。

## 命令

```bash
tabboard init                  # 首次初始化
tabboard list [--kind tabs]    # 列数据湖
tabboard show <kind> <id>      # 查单条
tabboard backup --file <json>  # 从 JSON 文件写
tabboard doctor                # 健康检查
tabboard version
```

## Chrome side

```js
await chrome.runtime.sendNativeMessage('com.tabboard.tb', {
  command: 'backup',
  records: [{ kind: 'groups', data: {...} }]
});
```

## License

UNLICENSED — internal project.
