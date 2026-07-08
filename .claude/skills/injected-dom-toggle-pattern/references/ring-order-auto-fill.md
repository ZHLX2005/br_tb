# Ring Order Auto-Fill — 多圆环垂直自动补位

> 配套 `draggable-ring.md`(拖动)和 `adding-a-new-ring.md`(新 ring)。本 ref 讲**多 ring 协调器**:
> 关闭中间一个 ring → 其他 ring **瞬时顶位**,不留下 52px 间隙;同时不破坏拖动持久化位置。

## 适用场景

悬浮圆环 ≥2 个时,用户希望:
- popup 关闭某个 ring → **剩下的 ring 自动向上顶**,紧密相邻
- popup 重新打开 → **回到原位**(不动)
- 拖动过的位置 + 自动补位 **不冲突**(拖动锚点保留)
- 切换 master 总开关 → 全部隐藏/显示一致
- 切换瞬间有 ring 正在 build/register(竞态)→ 状态仍正确

## 核心机制(一句话)

CSS 是垂直位置的**唯一** source of truth。所有 ring 的 trigger/panel 用同一条 CSS:

```css
top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
```

- `--ring-stack-anchor` — 拖动锚点 Y(px 值,默认 `50%`),由 `draggable-ring.js` 写
- `--ring-order` — 该 ring 在存活列表中的连续序号(0/1/2...),由 `ring-order.js` 写

两个 CSS 变量各管一个维度,CSS `calc()` 在每次属性变化时自动重算位置。**两个 writer 互不读写,不可能冲突**。

## 架构图

```
content/shared/ring-order.js    (manifest 第一位,先于所有 ring)
  └─ 暴露 window.__tabboardRingOrder:
       register({ ringId, host, defaultOrder, isAlive })
       recompute()   — 按 defaultOrder 升序给 alive ring 派发 0,1,2...
       getLastSettings()   — 给 isAlive 闭包查 settings
       getCurrentOrder(ringId)   — 给 draggable-ring 查当前序号

content/shared/draggable-ring.js    (manifest 第二位)
  └─ attach(trigger, panel, host, { defaultOrder, ringId })
     写 --ring-stack-anchor 到 host(不再写 inline top)

content/lcSidebar.js     defaultOrder: 0, ringId: 'lc'
content/vpSidebar.js     defaultOrder: 1, ringId: 'vp'
content/timerSidebar.js  defaultOrder: 2, ringId: 'timer'
content/captureRing.js   defaultOrder: 3, ringId: 'capture'

每个 ring 的 build() 末尾:
  1. document.body.appendChild(wrapper)
  2. window.__tabboardRingDrag.attach(trigger, panel, wrapper, { defaultOrder, ringId })
  3. window.__tabboardRingOrder.register({ ringId, host: wrapper, defaultOrder, isAlive })
```

## 最小实现

### ring-order.js(协调器,manifest 第一位)

```javascript
(function () {
  'use strict';
  window.__tabboardRingRegistry = window.__tabboardRingRegistry || [];
  var lastSettings = {};

  window.__tabboardRingOrder = {
    register: function (cfg) {
      if (!cfg || !cfg.ringId || !cfg.host || typeof cfg.defaultOrder !== 'number' || typeof cfg.isAlive !== 'function') {
        console.warn('[ring-order] invalid cfg', cfg); return;
      }
      // 三档 dedup:
      //   1. 同 ringId + 同 host  → 真重复,跳过
      //   2. 同 ringId + host 还活着 → 异常(应从未发生),跳过
      //   3. 同 ringId + host 已 detached → 替换(新 build 接管)
      var existing = window.__tabboardRingRegistry.find(function (r) { return r.ringId === cfg.ringId; });
      if (existing) {
        if (existing.host === cfg.host) return;
        if (existing.host && existing.host.isConnected) return;
        existing.host = cfg.host;
        existing.defaultOrder = cfg.defaultOrder;
        existing.isAlive = cfg.isAlive;
      } else {
        window.__tabboardRingRegistry.push({ ringId: cfg.ringId, host: cfg.host, defaultOrder: cfg.defaultOrder, isAlive: cfg.isAlive });
      }
      this.recompute();
    },

    recompute: function () {
      // 清理已 detach 的 host
      window.__tabboardRingRegistry = window.__tabboardRingRegistry.filter(function (r) {
        return r.host && r.host.isConnected;
      });
      // 按 defaultOrder 升序,只取 isAlive 的,连续派发 0,1,2...
      var alive = window.__tabboardRingRegistry
        .filter(function (r) { return r.isAlive(); })
        .sort(function (a, b) { return a.defaultOrder - b.defaultOrder; });
      alive.forEach(function (r, i) { r.host.style.setProperty('--ring-order', String(i)); });
    },

    getLastSettings: function () { return lastSettings; },

    getCurrentOrder: function (ringId) {
      var alive = window.__tabboardRingRegistry
        .filter(function (r) { return r.isAlive(); })
        .sort(function (a, b) { return a.defaultOrder - b.defaultOrder; });
      for (var i = 0; i < alive.length; i++) {
        if (alive[i].ringId === ringId) return i;
      }
      return -1;
    }
  };

  // 监听 settings 变化 → 缓存 + 延迟重排
  // setTimeout(0):等各 ring 的 onChanged handler 同步完成 build/remove 后再算
  chrome.storage.onChanged.addListener(function (changes, ns) {
    if (ns !== 'local' || !changes.settings) return;
    lastSettings = changes.settings.newValue || {};
    setTimeout(function () { window.__tabboardRingOrder.recompute(); }, 0);
  });

  // 初始化主动拉一次 settings
  try {
    chrome.runtime.sendMessage({ action: 'getSettings' }, function (res) {
      if (res && res.success && res.settings) lastSettings = res.settings;
    });
  } catch (e) {}
})();
```

### 各 ring 的 CSS(trigger 和 panel 同款)

```css
:host {
  position: fixed; top: 50%; right: 0;   /* host 始终 50%,作为 calc 锚点 */
  z-index: 999999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#WRAPPER_ID-trigger {
  position: fixed;
  top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
  right: -16px;
  /* ...其他样式 */
}
#WRAPPER_ID-panel {
  position: fixed;
  top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
  right: 8px;
  /* ...其他样式 */
}
```

### 每个 ring 的 build() 末尾

```javascript
// 1. 挂到 body
document.body.appendChild(wrapper);

// 2. 启用拖动(可选,需要可拖动才加)
window.__tabboardRingDrag && window.__tabboardRingDrag.attach(
  shadow.getElementById(WRAPPER_ID + '-trigger'),
  shadow.getElementById(WRAPPER_ID + '-panel'),
  wrapper,                         // ← host 元素,drag 写 --ring-stack-anchor 到它上面
  { defaultOrder: 0, ringId: 'lc' } // ← ringId 让 draggable-ring 查当前 order
);

// 3. 注册到协调器(必做,否则不参与自动补位)
window.__tabboardRingOrder && window.__tabboardRingOrder.register({
  ringId: 'lc',
  host: wrapper,
  defaultOrder: 0,
  isAlive: function () {
    if (!document.getElementById(WRAPPER_ID)) return false;
    var s = window.__tabboardRingOrder.getLastSettings();
    if (!s) return true; // 缓存未就绪,保守按"显示"
    return s.ringSidebarEnabled !== false && !!s.showLcSidebar;
  }
});
```

## 关键算法

### 关闭 LC 后的视觉追踪

| 步骤 | ring-state | VP | Timer | Capture |
|------|-----------|----|----|---------|
| 初始,4 ring 都在 | --ring-order | 1 | 2 | 3 |
| 拖 LC 下来 100px | --ring-stack-anchor = 500px(全部 host) | — | — | — |
| 关闭 LC | LC host 被 `wrapper.remove()` | 0 | 1 | 2 |
| CSS calc(假设 default 50% 时 innerHeight/2=400) | — | `calc(500px + 52*0) = 500` | `calc(500px + 52*1) = 552` | `calc(500px + 52*2) = 604` |

VP 紧贴 LC 原锚点下方(500),间距 52px 保持。**没有 52px 间隙**。

### dedup 三档行为表

| 旧 host | 新 host | 行为 | 原因 |
|---------|---------|------|------|
| === 新 host | — | skip | 真重复 |
| isConnected=true | !== 旧 | skip | 异常,保留旧 |
| !isConnected | !== 旧 | **replace** | 让新 build 接管 |

### isAlive 闭包设计

- **永远先查 DOM 存在**(`document.getElementById(WRAPPER_ID)`)— DOM 被 remove 后立即 false
- 然后查 settings 缓存(`getLastSettings()`)— 不要做 getSettings 走 message passing
- 缓存未就绪时 fallback:保守按"显示",等下个 recompute 纠正

## 关键约束

| 约束 | 原因 |
|------|------|
| ring-order.js **必须**在 manifest 所有 ring 之前注入 | IIFE 同步设 `window.__tabboardRingOrder`,否则 ring build() 时不存在 |
| 每个 ring **必须**同时调 attach + register | attach 管拖动,register 管序号,缺一失效 |
| attach 第三个参数 **必须**是 host(不是 trigger) | drag 写 `--ring-stack-anchor` 到 host 元素 |
| drag **禁止**写 inline `style.top` 到 trigger/panel | inline top 永远比 CSS calc 优先级高,会覆盖 `--ring-order` 重排 |
| recompute 走 setTimeout(0) | 等各 ring 的 onChanged 同步 handler 完成 build/remove 后再算 |
| dedup 拒绝"旧 host 还活着" | 同一 ringId 只能有一个活的 host,否则两个 --ring-order 抢位置 |

## 错误案例(踩过的坑)

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| ring-order.js 放在 ring 之后注入 | ring build 时 `window.__tabboardRingOrder` 是 undefined,register 被可选链静默跳过,自动补位不工作 | 合并到同一 content_script 块,**第一位** |
| recompute 不用 setTimeout(0) | 同步跑时各 ring 还没 build/remove,看到的是中间态 DOM,序号分配错乱 | setTimeout(0) 推到下一帧 |
| dedup 用 `find` 后直接 `return`(不做三档) | 快速 toggle 关→开时,旧 host 还没被 setTimeout(0) 清理,新 host 被 skip → 新的 wrapper 拿不到 --ring-order → 多个 ring 落回 0 重叠 | 三档 dedup:同 host 跳 / 活 host 跳 / 死 host 替换 |
| isAlive 每次都 `chrome.runtime.sendMessage({action: 'getSettings'})` | 异步,recompute 时 settings 还没回,看到的是上一次缓存或空 | 用 `getLastSettings()` 读协调器缓存 |
| 拖动写 `trigger.style.top = '${y}px'` | inline top 永久覆盖 CSS calc(--ring-order),关闭其他 ring 后其他 ring 不会动 | drag 只写 `host.style.setProperty('--ring-stack-anchor', y + 'px')` |
| attach 第三个参数传 triggerEl | drag 写 CSS 变量到 trigger(在 shadow DOM 内),CSS 变量在 host 上读不到 | 传 `wrapper`(主文档可见的 host) |
| recalc 时不清理 detached host | registry 累积死 entry,recompute 对它们 setProperty 静默失败但浪费 CPU | filter `r.host.isConnected` |
| 不用 ringId,只传 defaultOrder | 关闭其他 ring 后,drag 的 `getCurrentOrder` 拿不到动态序号(全部 ring 的 defaultOrder 仍是 0/1/2/3),拖动联动仍用旧序号 → VP 拖动时 LC 跳到 VP 位置 | 传 `ringId`,drag 用 `__tabboardRingOrder.getCurrentOrder(ringId)` 查动态序号 |

## 初始化闪烁(可接受,非 bug)

页面加载 + 之前拖过圆环:
1. 各 ring IIFE 跑,build,attach,register → `recompute` 同步设 `--ring-order`
2. 首次渲染:各 ring 在 `calc(50% + 52*order)` 的位置(0/52/104/156)
3. 几毫秒后 `initPositionFromStorage` 回调触发,写 `--ring-stack-anchor: savedY px` 到各 host
4. CSS 重算:整个 ring 栈从 center-spread 同步平移到 `savedY-spread`

**现象**:整个栈同步滑动一下,不是单 ring 闪烁。**可接受**。要消除可在 `attach` 时同步读 storage(用 `chrome.storage.local.get` 的 sync 版本或预读),但实现复杂、收益小。

## 检查清单

- [ ] manifest 中 `content/shared/ring-order.js` 在所有 ring 之前注入
- [ ] manifest 中 `content/shared/draggable-ring.js` 在所有 ring 之前注入(且在 ring-order 之后)
- [ ] 4 个 ring 的 CSS trigger/panel 都用 `top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`
- [ ] 每个 ring build() 末尾都调 `register({ ringId, host: wrapper, defaultOrder, isAlive })`
- [ ] 每个 ring 调 `attach(trigger, panel, wrapper, { defaultOrder, ringId })` 4 参
- [ ] `defaultOrder` 按 manifest 注册顺序,值为 0/1/2/3,**全集合不能缺号**
- [ ] `ringId` 字符串在 4 个 ring 间唯一(`'lc' / 'vp' / 'timer' / 'capture'`)
- [ ] `isAlive` 先查 `document.getElementById(WRAPPER_ID)`,再读 `getLastSettings()` 缓存
- [ ] draggable-ring 只写 `--ring-stack-anchor` 到 host,从不写 inline `style.top`
- [ ] draggable-ring 用 `getCurrentOrder(ringId)` 而非 `defaultOrder` 算锚点偏移
- [ ] recompute 用 `setTimeout(0)`,在所有 onChanged handler 跑完后才执行
- [ ] register 三档 dedup:同 host 跳过 / 活 host 跳过 / 死 host 替换
- [ ] register 前 recompute 时 filter `r.host.isConnected`,清理 detached host

## 何时不触发本 ref

- 只有一个 ring(没东西可"补位")→ 不需要协调器
- 圆环位置用 master 总开关 + 整体动画方案(全显/全隐)→ 也不需要
- 圆环横向排列或环形布局 → 用其他协调模式
