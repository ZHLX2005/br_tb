# UI 流程 — video-tracker 模块

> 添加视频 / 批量导入的完整流程图与关键决策。

## 添加视频流程（modules/video-progress/view.js）

```
用户点击 "+ 添加视频" / "添加当前视频"
  → 输入 URL（或获取当前标签页）
  → chrome.tabs.create({url, active: true})  // 必须前台打开！
  → for (attempt = 0; attempt < 5; attempt++):
       await sleep(2000)
       chrome.tabs.sendMessage(tab.id, {action: 'detectVideos'})
       if (results.videos.length > 0) break  // 提前命中
  → chrome.tabs.update(selfTab.id, {active: true})  // 切回 module 页
  → chrome.tabs.remove(tab.id)  // 关闭视频页
  → chrome.runtime.sendMessage({action: 'addVideoToGroup', ...})
  → 刷新列表
```

**关键细节**：

- 必须先 `tabs.update(selfTab, {active: true})` **再** `tabs.remove(tab)`，否则关闭后浏览器会切换到其他无关标签页
- 轮询探针比固定 10s 等待更高效（视频可能 3s 就加载好了）

---

## 批量导入流程

```
用户打开批量导入对话框
  → 选择目标课程（下拉框）
  → 输入链接（一行一个）或上传 .txt 文件
  → 点击开始导入
  → for (i = 0; i < urls.length; i++):
       更新进度条
       chrome.tabs.create({url, active: true})
       轮询检测（2s × 5 次）
       chrome.tabs.remove(tab.id)
       sendMessage({action: 'addVideoToGroup'})
       success/skip/fail 计数
  → 全部完成后：
       切回 module 页
       显示统计结果（成功/已存在/失败）
       刷新列表
```

---

## 关键决策详解

### 为什么必须 `active: true`？

Chrome 的 autoplay policy：**后台标签页的视频不会自动加载**，导致 `<video>` 元素没有 `duration`，content script 永远返回空数组。`active: true` 让视频页成为前台标签，浏览器才会真正加载。

| `active` | 视频加载 | content script 能检测到吗 |
|---|---|---|
| `true` | 是 | ✅ |
| `false` | 否（autoplay blocked） | ❌ |

### 为什么 2s 轮询探针 × 5 次？

- **太短（如 500ms × 10）**：探针太频繁，浪费 CPU
- **太长（如固定 10s）**：视频 3s 就加载好，仍要等 10s，UX 慢
- **2s × 5 = 最多 10s**：覆盖慢网络 + 提前命中立即退出

```javascript
let detectedVideos = [];
for (let attempt = 0; attempt < 5; attempt++) {
  await sleep(2000);
  const results = await chrome.tabs.sendMessage(tab.id, { action: 'detectVideos' });
  if (results.videos.length > 0) {
    detectedVideos = results.videos;
    break;  // 提前命中，立即退出
  }
}
```

### 为什么先 `tabs.update(selfTab)` 再 `tabs.remove(tab)`？

顺序反了的话：

```javascript
// ❌ 错误顺序
chrome.tabs.remove(tab.id);              // 关闭视频页
// 此时 active tab 浏览器自动切到 module 页
// 但因为没有先 tabs.update 显式激活，浏览器可能切到其他无关标签
```

正确顺序：

```javascript
// ✅ 正确顺序
chrome.tabs.update(selfTab.id, { active: true });  // 显式切回 module
chrome.tabs.remove(tab.id);                          // 再关视频页
```

---

## 失败 / 重复处理

### `addVideoToGroup` 返回值处理

| 响应 | 处理 |
|---|---|
| `{ success: true, video }` | showToast 成功，刷新列表 |
| `{ success: false, error: 'Video already in group' }` | showToast 警告（已在课程中） |
| `{ success: false, error: 'Group not found' }` | showToast 错误（课程组不存在） |
| `{ success: false, error: <other> }` | showToast 通用错误 |

### 批量导入统计

```
success:  addVideoToGroup 成功 + 视频不在课程
skip:     'Video already in group'（视为正常，不报错）
fail:     'Group not found' / 视频页打不开 / network 错误
```

完成时显示 `成功 X / 已存在 Y / 失败 Z`。

---

## 与 popup / sidepanel 的差异

| 模块 | 入口 | 课程组选择 | 批量导入 |
|---|---|---|---|
| `modules/video-progress/view.js` | 完整管理页面 | 列表内联 | 支持 |
| `popup/modules/videoCapture.js` | popup 按钮 | 弹窗 prompt 输入编号 | 不支持 |
| 侧边栏 / 注入圆环 | ring trigger | 详见 ring 设计 | 不支持 |

popup 的 `captureVideo` 流程比完整 view.js 简单：

```
chrome.tabs.query({active: true, currentWindow: true})
  → chrome.tabs.sendMessage({action: 'detectVideos'})
  → 单视频：addVideoToGroupDialog（prompt 输入组编号）
  → 多视频：selectVideoDialog（先选视频编号，再选组编号）
  → 无视频组：confirm 创建新课程
```