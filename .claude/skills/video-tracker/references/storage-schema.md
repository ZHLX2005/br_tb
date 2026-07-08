# 存储 Schema — video-tracker 模块

> `chrome.storage.local` 中 video-tracker 相关的完整数据结构。

## 顶层 keys

```javascript
{
  videoGroups: [
    {
      // ... 课程组 schema 见下方
    }
  ]
  // 其他 keys（settings, timerState 等）由其他模块管理，不在本 schema 范围
}
```

---

## videoGroups[].videos[]

```typescript
interface Video {
  id: string;            // generateId() 生成
  title: string;         // 用户可编辑（content script 不覆盖）
  url: string;           // normalizeUrl 处理后的 URL
  duration: number;      // 秒（content script 上报）
  watched: number;       // 当前最大观看位置（秒），只增不减
  favicon: string;       // 网站 favicon URL
  pageTitle: string;     // 视频所在页面的标题（去 SPA 切换后可能过期）
  addedAt: string;       // ISO timestamp，由 addVideoToGroup 设置
}
```

**关键不变量**：

- `url` 永远是 `normalizeUrl(v.url)` 之后的值，**禁止**直接保存原始 URL
- `watched` 不可倒退，updateVideoProgress 必须用 `Math.max(old, new)`
- `title` 由用户/导入时设定，content script 上报**不覆盖**（防止重命名被还原）

---

## videoGroups[].archiveSnapshot

归档课程时保存的快照：

```typescript
interface ArchiveSnapshot {
  videos: Array<{
    id: string;
    title: string;
    duration: number;
    watched: number;
  }>;
  totalDuration: number;  // sum(duration)
  totalWatched: number;   // sum(watched)
  videoCount: number;
}
```

**触发时机**：调用 `archiveVideoGroup` 时生成。归档后 `group.archived = true`、`group.archivedAt = ISO timestamp`，但 `group.videos` 仍保留完整数据，**不删除**。

**取消归档**：`unarchiveVideoGroup` 把 `archived` / `archivedAt` / `archiveSnapshot` 三个字段还原为 false / null / null，`videos` 数据不变。

---

## 完整 videoGroups[i] schema

```typescript
interface VideoGroup {
  id: string;
  name: string;
  color: string;        // HEX
  createdAt: string;    // ISO
  archived: boolean;
  archivedAt: string | null;
  archiveSnapshot: ArchiveSnapshot | null;
  videos: Video[];
}
```

---

## 字段含义速查表

| 字段 | 来源 | 谁可改 | 备注 |
|---|---|---|---|
| `id` | generateId() | 永不 | 创建时定 |
| `name` | 用户输入 | renameVideoGroup | |
| `color` | 用户输入 | 暂无 action | 后续可加 |
| `createdAt` | addVideoGroup 时 | 永不 | |
| `archived` | archiveVideoGroup | unarchive | boolean |
| `archivedAt` | 同上 | 同上 | ISO |
| `archiveSnapshot` | 同上 | 同上 | 归档时定 |
| `videos` | addVideoToGroup | removeVideoFromGroup / reorderGroupVideos | |
| `video.id` | addVideoToGroup 时 | 永不 | |
| `video.title` | 用户/导入 | updateVideoTitle | content script 不覆盖 |
| `video.url` | addVideoToGroup 时 | 永不 | normalizeUrl 后存 |
| `video.duration` | content script 上报 | updateVideoProgress | |
| `video.watched` | content script 上报 | updateVideoProgress | 只增不减 |
| `video.addedAt` | addVideoToGroup 时 | 永不 | |

---

## 存储限制与性能

- `chrome.storage.local` 单个 key 限制约 5MB
- 大量视频课程（>1000）需考虑分页 / 归档 / 清理策略
- `getVideoGroups` 每次返回全量数据，渲染时按需 filter `!archived`
- 写操作（addVideoToGroup / updateVideoProgress）每次全量 `chrome.storage.local.set({ videoGroups })`，避免部分更新导致的不一致

---

## 与其他模块共享的字段

- `videoGroups` 仅由 video-tracker 模块独占
- `groups` / `tabs`（标签页分组）是另一个模块的存储，不要混淆
- `settings.ringSidebarEnabled` 等是全局设置，与本模块无 schema 冲突