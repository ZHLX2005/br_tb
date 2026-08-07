# 扩展一个新圆环 — 参考流程与样本代码

> 配套 `hover-reveal.md`（原理）和 `ux-design-style.md`（设计）。这篇是 **cookbook**：照着抄就能加一个新圆环，附错误/成功样本代码对比。

## 什么时候用这篇

当要在 TabBoard（或任何多 content script 注入式扩展）里**新增一个悬浮圆环入口**时——番茄钟、AI 助手、笔记速记、稍后读、任意「寄生在页面右侧边缘的轻量入口」。照这篇抄，避免重复踩这次 VP 圆环踩过的坑。

## 前置：现有机制（必读）

> **本篇只覆盖 Mode A（Ring-Stack Entry）**——圆环要进右侧栈、受 master 控制、参与整体拖动。
> Mode B（Free-Floating,独立圆环,如 noteRing / goto）走 `references/free-floating-entry.md`,**别混**。

- **LC 圆环** = `content/lcSidebar.js`，受 `settings.showLcSidebar` 开关控制
- **VP 圆环** = `content/vpSidebar.js`，总是显示
- 两者共享 `body.tabboard-side-near` + 各 host `.near`:鼠标靠近右边缘时 JS **同时** toggle body class 和每个 ring host 的 `.near`
  - CSS 用 `:host(.near) #${WRAPPER_ID}-trigger` 响应(在 shadow DOM 内只能 `:host(.near)` 选中 host)
  - `body.tabboard-side-near` 是为跨 shadow boundary 的外部逻辑服务的(如以后要做 `:has` 选择器等)
- mousemove 监听靠 `window.__tabboardSideReveal` **幂等注册**——不管几个圆环文件，全局只注册一次
- 所有圆环 CSS 统一用 `:host(.near)` 触发滑出

## 扩展流程（6 步）

### Step 1：新建 `content/xxxSidebar.js`

复制下面「最小模板」，改 4 处：
1. `WRAPPER_ID`（唯一前缀，如 `'tabboard-pomodoro-sidebar'`）
2. `top` 位置（见 Step 3，避免和现有圆环重叠）
3. 圆环图标（trigger 的 innerHTML）
4. 面板内容（panel 的 innerHTML）

### Step 2：`manifest.json` 注册

**所有 ring + 共享模块必须合并到一个 content_scripts 块**,按以下顺序排列(顺序错会导致 API 未就绪):

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "content/shared/ring-order.js",
        "content/shared/draggable-ring.js",
        "content/lcSidebar.js",
        "content/vpSidebar.js",
        "content/timerSidebar.js",
        "content/captureRing.js",
        "content/xxxSidebar.js"
      ],
      "run_at": "document_end"
    }
  ]
}
```

- `ring-order.js` **第一位**——协调器,所有 ring build 之前必须就绪
- `draggable-ring.js` **第二位**——拖动,ring build 时调 attach
- 各 ring 放后面,按 defaultOrder 顺序

> 多个 ring 在 manifest 中按注册顺序排列(影响 defaultOrder)。把新 ring 加到列表末尾,defaultOrder 自动 = 列表长度 - 1。

### Step 3：分配垂直位置(动态序号)

**重要**：不要把"top 写死成 calc(50% + 52*N px)"。如果按这个硬编码,关闭中间一个 ring 后剩下 ring 不会自动顶位(留下 52px 间隙)。应该用 **CSS 变量自动补位**(`references/ring-order-auto-fill.md`):

```css
#${WRAPPER_ID}-trigger {
  position: fixed;
  top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
  right: -16px;
  ...
}
#${WRAPPER_ID}-panel {
  position: fixed;
  top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
  right: 8px;
  ...
}
```

`--ring-order` 由 `content/shared/ring-order.js` 协调器按 manifest 注册顺序派发 0,1,2,3...;关闭中间 ring 后其他 ring 自动重新连续派发,瞬时顶位。

**唯一需要你定的是 `defaultOrder`**:在 manifest 里 ring 出现的顺序,从 0 开始数。例如:

| 序号(`defaultOrder`) | 圆环 | 备注 |
|------|------|------|
| 0 | LC | 第一位 |
| 1 | VP | |
| 2 | Timer | |
| 3 | 下一个 | 你的新 ring |

**trigger 和 panel 要用同一个 CSS**(都是 `calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`)。

### Step 4：接入 master 总开关（必做）+ 决定子开关

**所有 ring-sidebar 都必须先过 master 总开关** `ringSidebarEnabled`，否则用户在 popup 关了总开关，你这个圆环还在，行为不一致。

最小接入（上面模板的 init + 监听已含）：init 里 `if (s.ringSidebarEnabled === false) return;`，监听里关→`remove()`、开→`build()`。

如需本圆环**自己的子开关**（像 LC 有 `showLcSidebar`、VP 有 `showVpSidebar`）：

```js
// init 里多加一行（用你的 settings key,如 showXxxSidebar）
if (s.showXxxSidebar === false) return;
// 监听里 shouldShow = s.ringSidebarEnabled !== false && s.showXxxSidebar !== false
```

并在 `popup/popup.html` 的「注入DOM控制」板块加子 checkbox(`ring-sub` class)、`background/init.js` 加 `showXxxSidebar: true` 默认值、popup 新建独立 settings 模块。

> master 用 `=== false` 判断（undefined 视为开，向后兼容老用户）。当前 LC、VP 都既有 master 守卫也有自己的子开关，因此模板默认展示双守卫。如果你的圆环确实不需要单独关闭，可以只跟 master。

### Step 5：popup 里的 UI 分组规范

新增圆环开关必须遵循「注入DOM控制」专区布局(Mode A 子开关):

```html
<div class="page-section">
  <div class="section-title">注入DOM控制</div>
  <div class="settings-list">
    <!-- master：加粗 + 下分隔线 -->
    <label class="setting-row ring-master">
      <input type="checkbox" id="popupRingSidebarEnabled">
      <span>圆环侧边栏（总开关）</span>
    </label>
    <!-- 接入 master 的子开关：缩进 -->
    <label class="setting-row ring-sub">
      <input type="checkbox" id="popupShowXxxSidebar">
      <span>我的圆环</span>
    </label>
    <!-- 不接入 master 的独立入口：不缩进（Mode B 自由圆环） -->
    <label class="setting-row">
      <input type="checkbox" id="popupShowGotoRing">
      <span>悬浮 goto 圆环（所有页面）</span>
    </label>
  </div>
</div>
```

对应 CSS（已存在 `popup.css`）：
- `.ring-master`：加粗、底部 1px 分隔线
- `.ring-sub`：`padding-left: 20px`
- `input:disabled` + `.setting-row:has(input:disabled)`：master 关时子开关整行置灰

### Step 6：刷新扩展 + 强刷测试页面（Ctrl+Shift+R）

content script 不会自动重新注入已打开的页面，**必须刷新页面**。

---

## 最小代码模板（Shadow DOM 版，直接抄）

> **必须用 Shadow DOM**：宿主页(Notion/Linear/Figma)的 CSS reset 会穿透普通注入 UI 导致样式失效。详见 `shadow-dom-isolation.md`。

```javascript
/**
 * XXX Sidebar — 一句话描述这个圆环干什么
 * 悬浮右侧，hover 近场浮现，点击展开面板；Shadow DOM 隔离宿主 CSS
 */
(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-xxx-sidebar';   // ← 改这里：唯一前缀（host id，主文档可见）
  const ACCENT = '#42a5f5';

  const STYLES = `
    /* host 自身样式 + CSS 变量必须用 :host（shadow 内 #id 选不到 host）
       严禁加 transform: 会创建 containing block，多 ring 拖动时坐标系混乱 */
    :host {
      position: fixed; top: 50%; right: 0;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;  /* 防宿主字体穿透 */
      --accent: ${ACCENT};
    }
    /* 触发器位置由双 CSS 变量控制:见 references/ring-order-auto-fill.md
       --ring-stack-anchor 由 draggable-ring.js 拖动时写入(默认 50%)
       --ring-order 由 ring-order.js 协调器写入(默认 0,关闭其他 ring 后自动重排) */
    #${WRAPPER_ID}-trigger {
      width: 40px; height: 40px; border-radius: 50%; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0)); right: -16px;
      transform: translateY(-50%); opacity: 0; pointer-events: none;
      transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
      border: 1px solid rgba(0,0,0,0.06);
    }
    /* 近场浮现：:host(.near) 由 JS 同步（body.tabboard-side-near 跨 shadow boundary 不可达） */
    :host(.near) #${WRAPPER_ID}-trigger,
    #${WRAPPER_ID}-trigger:hover {
      right: 8px; opacity: 1; pointer-events: auto;
    }
    #${WRAPPER_ID}-trigger:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.22); }

    #${WRAPPER_ID}-panel {
      position: fixed; top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0)); right: 8px;   /* ← 和 trigger 同 top */
      transform: translate(10px, -50%); width: 240px;
      background: white; border-radius: 10px;
      box-shadow: -2px 4px 20px rgba(0,0,0,0.18);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s linear 240ms;
    }
    /* 展开状态同样用 :host(.expanded) */
    :host(.expanded) #${WRAPPER_ID}-panel {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translate(-56px, -50%);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s;
    }
    /* ↓ 面板内部样式按需加；shadow 内类名天然隔离，可不再加 WRAPPER_ID 前缀 */
  `;

  function build() {
    if (document.getElementById(WRAPPER_ID)) return;

    // host 挂在 body；trigger + panel + style 全部装进 Shadow Root（隔离宿主 CSS）
    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    const shadow = wrapper.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    const trigger = document.createElement('div');
    trigger.id = WRAPPER_ID + '-trigger';
    trigger.title = 'XXX';
    trigger.innerHTML = `<span style="font-size:11px;font-weight:700;color:${ACCENT}">XX</span>`;  // ← 改图标
    shadow.appendChild(trigger);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.classList.toggle('expanded');   // class 加在 host 上，CSS 用 :host(.expanded) 响应
    });

    const panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `<div style="padding:12px;font-size:12px;color:#333">面板内容</div>`;  // ← 改面板
    shadow.appendChild(panel);

    // 点击外部收起（事件 retarget 到 host，wrapper.contains(e.target) 仍成立）
    const onDocClick = (e) => {
      if (!wrapper.classList.contains('expanded')) return;
      if (wrapper.contains(e.target)) return;
      wrapper.classList.remove('expanded');
    };
    setTimeout(() => document.addEventListener('click', onDocClick), 0);

    // 【视觉同步关键】共享近场浮现：幂等注册，多圆环只注册一次 mousemove
    // 同时 toggle body.tabboard-side-near（给外部逻辑）和每个圆环 host 的 .near（shadow 内 :host(.near) 响应）
    if (!window.__tabboardSideReveal) {
      window.__tabboardSideReveal = true;
      document.addEventListener('mousemove', (e) => {
        const near = e.clientX > window.innerWidth - 40;
        document.body.classList.toggle('tabboard-side-near', near);
        document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])')
          .forEach(host => host.classList.toggle('near', near));
      });
    }

    document.body.appendChild(wrapper);   // host 最后挂到 body

    // 可选:启用拖动(让圆环可拖到任意位置,且与 ring-order 协调器联动)
    // 需要 manifest 同时注入 content/shared/draggable-ring.js 和 content/shared/ring-order.js
    // 见 references/draggable-ring.md 和 references/ring-order-auto-fill.md
    window.__tabboardRingDrag && window.__tabboardRingDrag.attach(
      shadow.getElementById(WRAPPER_ID + '-trigger'),
      shadow.getElementById(WRAPPER_ID + '-panel'),
      wrapper,                                  // ← 第三个参数必须是 host
      { defaultOrder: N, ringId: 'myRing' }     // ← N 改 Step 3 序号(0/1/2/3);ringId 唯一
    );

    // 必做:注册到 ring-order 协调器,参与垂直自动补位
    window.__tabboardRingOrder && window.__tabboardRingOrder.register({
      ringId: 'myRing',                         // ← 同上,唯一
      host: wrapper,
      defaultOrder: N,                          // ← N 同上
      isAlive: function () {
        if (!document.getElementById(WRAPPER_ID)) return false;
        var s = window.__tabboardRingOrder.getLastSettings();
        if (!s) return true;                    // 缓存未就绪时保守按"显示"
        return s.ringSidebarEnabled !== false && s.showXxxSidebar !== false;
      }
    });
  }

  // 主文档查询 shadow 子树：走 wrapper.shadowRoot（document.getElementById 只能查到 host）
  function getShadow() {
    const w = document.getElementById(WRAPPER_ID);
    return w && w.shadowRoot;
  }

  // 显示条件：master 总开关开 + 本圆环子开关开（两者都用 === false 判断，undefined 视为开）
  function shouldHide(s) {
    return s.ringSidebarEnabled === false || s.showXxxSidebar === false;
  }

  async function init() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const s = res.success ? (res.settings || {}) : {};
      if (shouldHide(s)) return;
      build();
    } catch (err) { /* 扩展上下文可能失效 */ }
  }

  // 监听：应当显示就 build、应当隐藏就移除 DOM（不是只 opacity:0）
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local' || !changes.settings) return;
    const s = changes.settings.newValue || {};
    const el = document.getElementById(WRAPPER_ID);
    if (shouldHide(s)) { if (el) el.remove(); }
    else if (!el) build();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

---

## Interactive 控制面板环

如果环不只是静态信息面板，还需要**交互操作**（滑块调值、切换开关、预设按钮），需在基础模板之上增加以下模式。

### 通信架构：UI 环 ↔ 业务 content script

核心原则：**环只负责 UI 交互和后端通信，不直接操作 DOM/**HTML 元素。真正的业务逻辑交给同页面里独立运行的另一个 content script（如已有 `videoSpeed.js`）。

```
用户操作面板 → postMessage → 业务 content script → 写入 storage + 操作 DOM/元素
                 ↓ (storage.onChanged)
            syncPanelUI() 更新面板视图
```

| 职责 | 由谁承担 |
|------|---------|
| 面板交互（滑块、预设、切换） | 新环（xxxSidebar.js） |
| 业务逻辑（操作 <video>、写数据） | 已有 content script（如 videoSpeed.js） |
| 持久化 | 业务 script 写 storage；环监听 storage.onChanged 同步 |

### `syncPanelUI()` 模式（交互式环必做）

面板不是静态 HTML——用户操作后、或外部修改了值，面板必须刷新。

```js
// 定义 sync 函数——从本地变量/内存读值，写入 shadow DOM
function syncPanelUI() {
  const wrapper = document.getElementById(WRAPPER_ID);
  if (!wrapper || !wrapper.shadowRoot) return;
  const root = wrapper.shadowRoot;

  // 更新显示值：数字/标签
  const valueEl = root.getElementById('my-value');
  if (valueEl) valueEl.textContent = currentValue + 'x';

  // 更新预设按钮激活态
  root.querySelectorAll('.my-preset-btn').forEach(function (btn) {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.val) - currentValue) < 0.01);
  });

  // 更新滑块位置
  root.getElementById('my-slider').value = currentValue;

  // 更新切换开关
  root.getElementById('my-toggle').checked = isEnabled;
}
```

**调用时机（三处）：** build() 末尾 / 每次用户操作后 / storage.onChanged 内。

### 从 storage 加载初始值 + storage.onChanged 同步

build 之前读取存储值，让面板有数据可显示：

```js
function loadMyValue(callback) {
  chrome.storage.local.get([STORAGE_KEY], function (result) {
    currentValue = result[STORAGE_KEY] ?? defaultValue;
    if (callback) callback(currentValue);
  });
}

function init() {
  try {
    chrome.runtime.sendMessage({ action: 'getSettings' }, function (res) {
      var s = res && res.success ? (res.settings || {}) : {};
      if (shouldHide(s)) return;
      loadMyValue(function () {
        build();
        syncPanelUI();
      });
    });
  } catch (err) {}
}
```

storage.onChanged 监听**两件事**：存储值变了（其他 tab 改了值）和 settings 变了（popup 开关切换了）：

```js
chrome.storage.onChanged.addListener(function (changes, ns) {
  if (ns !== 'local') return;

  if (changes[STORAGE_KEY]) {
    currentValue = changes[STORAGE_KEY].newValue ?? defaultValue;
    syncPanelUI();
  }

  if (changes.settings) {
    var s = changes.settings.newValue || {};
    var el = document.getElementById(WRAPPER_ID);
    if (shouldHide(s)) { if (el) el.remove(); }
    else if (!el) { init(); }
    // 同步面板里与 settings 相关的控件
    if (s.myEnableSetting !== undefined) {
      isEnabled = s.myEnableSetting !== false;
      syncPanelUI();
    }
  }
});
```

### postMessage 与同页面 content script 通信

环要触发另一个 content script（与环同页面运行，如 `videoSpeed.js`），用 `window.postMessage`：

```js
// 环这边——只管发消息，不管对方怎么处理
function applyAction(payload) {
  window.postMessage({ type: 'TABBOARD_MY_ACTION', payload: payload }, '*');
}
```

```js
// 业务 script 那边——监听消息，执行业务逻辑 + 持久化
window.addEventListener('message', function (event) {
  if (event.data.type === 'TABBOARD_MY_ACTION') {
    var val = event.data.payload;
    // 写 storage（环的 storage.onChanged 会收到并同步面板）
    chrome.storage.local.set({ [STORAGE_KEY]: val });
    // 操作 DOM/元素
    document.querySelectorAll('video').forEach(v => v.playbackRate = val);
  }
});
```

### 启用/禁用 toggle 的 reset 模式

面板里的"启用"开关，关闭时应**恢复默认值**（而非保持用户调的值）：

```js
var toggle = shadow.getElementById('my-enable-toggle');
if (toggle) {
  toggle.addEventListener('change', function (e) {
    e.stopPropagation();
    isEnabled = toggle.checked;
    if (isEnabled) {
      applyAction(currentValue);  // 开→应用设定的值
    } else {
      applyAction(defaultValue);  // 关→恢复默认
    }
    syncPanelUI();
  });
}
```

---

## 错误样本（这次踩的坑，❌ vs ✅）

### 坑 1：每个圆环各建 hover-zone → 只显示一个

**❌ 错误**（每个 content script 都这样写）：
```css
#mybar-hover-zone { position: fixed; top:0; right:0; width:32px; height:100vh; z-index: 999998; }
body:has(#mybar-hover-zone:hover) #mybar-trigger { right:8px; opacity:1; }
```
```js
const hoverZone = document.createElement('div');
hoverZone.id = WRAPPER_ID + '-hover-zone';
document.body.appendChild(hoverZone);
```
**后果**：两条 hover-zone 同 z-index 完全重叠，后建的盖住先建的。CSS `:hover` 只对鼠标下**最顶层**元素生效 → 被盖住的那个圆环**永不浮现**。症状：N 个圆环只能看到 1 个。

**✅ 正确**：不建 hover-zone，共享 `body.tabboard-side-near`：
```css
body.tabboard-side-near #mybar-trigger, #mybar-trigger:hover { right:8px; opacity:1; }
```
```js
if (!window.__tabboardSideReveal) {
  window.__tabboardSideReveal = true;
  document.addEventListener('mousemove', (e) => {
    document.body.classList.toggle('tabboard-side-near', e.clientX > window.innerWidth - 40);
  });
}
```

### 坑 2：动效不一致（LC 用 hover-zone，VP 用 mousemove）

**❌ 错误**：两个圆环用不同的浮现机制（一个 `:hover`，一个 `mousemove + class`），transition 参数或触发时机不同 → 视觉上一个先出一个后出、滑入距离不同。

**✅ 正确**：所有圆环统一用 `body.tabboard-side-near` + 同一套 transition。改一个地方（共享 class），所有圆环动效自动一致。

### 坑 3：入口塞进度/计数装饰

**❌ 错误**：trigger 里放 SVG 进度环显示完成百分比、放数字计数。
**后果**：视觉噪声，用户要求移除。入口变重。
**✅ 正确**：trigger 只放单一标识（字母 logo / 单图标），进度统计留到展开的面板里。

### 坑 4：trigger 放在 `display:flex` 的 wrapper 里，wrapper 还有不可见但占位的 panel

**❌ 错误**：
```css
#mybar { display:flex; right:0; }  /* wrapper flex */
#mybar-panel { width:240px; }      /* 不可见但占位 */
```
**后果**：panel 占布局空间，把 trigger 从右边缘推到屏幕中间（~240px 偏移）。
**✅ 正确**：trigger 和 panel 都 `position: fixed`，脱离 wrapper 布局流，各自独立相对视口定位。

### 坑 5：同步绑 document click → 打开即关

**❌ 错误**：
```js
document.addEventListener('click', (e) => { if(!wrapper.contains(e.target)) wrapper.classList.remove('expanded'); });
```
**后果**：点击 trigger 展开的那次 click 冒泡到 document，立刻触发收起 → 面板一闪而过。
**✅ 正确**：`setTimeout(() => document.addEventListener('click', onDocClick), 0)` 延一帧绑；同时 trigger 的 click 里 `e.stopPropagation()`。

### 坑 6：把新圆环代码塞进已有圆环的文件

**❌ 错误**：在 lcSidebar.js 里加 VP 逻辑。
**后果**：耦合，回退/调试困难，一个 bug 影响两个功能。
**✅ 正确**：一个圆环一个独立 content script 文件，manifest 各注册一条。

### 坑 7：updateSettings 整体覆盖

**❌ 错误**：开关 change 时 `chrome.storage.local.set({ settings: { myKey: val } })`（只传自己的 key）。
**后果**：覆盖掉 settings 里其他所有 key。
**✅ 正确**：发 `{ action: 'updateSettings', settings: { myKey: val } }`，background 是合并语义（`{ ...old, ...patch }`）。

### 坑 8：新圆环没接入 master 总开关

**❌ 错误**：新 ring 的 init 直接 `build()`，不检查 `ringSidebarEnabled`。
**后果**：用户在 popup 关了「圆环侧边栏（总开关）」，其他圆环都消失了，**唯独新圆环还在**，行为不一致。
**✅ 正确**：init 里 `if (s.ringSidebarEnabled === false) return;`；监听里关→`el.remove()`、开→`build()`。详见 Step 4。

### 坑 9：master 判断用 `=== true`，或关闭只设 opacity:0

**❌ 错误**：`if (settings.ringSidebarEnabled === true) build()`；关闭时只 `wrapper.style.opacity = 0` 不 remove。
**后果**：①老用户 settings 无此 key（undefined），`=== true` 判 false，所有圆环凭空消失；②`opacity:0` 的圆环仍被 hover/mousemove 触发，"隐藏"了还能弹出来。
**✅ 正确**：用 `=== false` 判断（undefined 默认开，向后兼容）；关闭时 `wrapper.remove()` 移除 DOM。

### 坑 10：Shadow DOM 内用 `#host-id` 选 host 自身（最高频）

**❌ 错误**：`#tabboard-xxx-sidebar.expanded #panel`、`#tabboard-xxx-sidebar { --accent: ... }`
**后果**：shadow 内 `#host-id` 选不到 host（host 是 shadow root，不是自己的后代）→ 状态不响应（点了没反应）/ CSS 变量丢失（蓝色全没）。**这是 Shadow DOM 改造后最容易连踩的坑。**
**✅ 正确**：host 自身的样式、状态、变量定义一律 `:host` / `:host(.expanded)` / `:host(.near)`。详见 `shadow-dom-isolation.md`。

### 坑 11：Shadow DOM 内查询子树用 `document.getElementById`

**❌ 错误**：`document.getElementById(WRAPPER_ID + '-panel')` → 返回 null
**后果**：refreshStats / 同步开关等更新逻辑静默失效。
**✅ 正确**：`const shadow = document.getElementById(WRAPPER_ID).shadowRoot; shadow.getElementById(...)`。host 本身在主文档可查，只有子树在 shadow 内。

### 坑 12：跨 shadow boundary 用 `body.class` 联动

**❌ 错误**：`body.tabboard-side-near #trigger { ... }`
**后果**：body 在 shadow 外，shadow 内 CSS 选不到 → hover 近场浮现失效。
**✅ 正确**：`:host(.near) #trigger`，JS 在主文档 mousemove 里同时 toggle `body` 和每个 host 的 `.near` class（模板里的 mousemove 块已含）。

### 坑 13：新环 ACCENT 颜色跟其他环不一致

**❌ 错误**：速度控制环用 `#ff7043`（橙色），其他环全部 `#42a5f5`（蓝色）。
**后果**：视觉突兀，用户要求统一。
**✅ 正确**：所有环统一用 `#42a5f5`（蓝色），除非有明确的设计理由区分颜色。新增环时先看一眼已有环的 ACCENT。

### 坑 14：交互式面板没有 `syncPanelUI()` / storage.onChanged 同步

**❌ 错误**：环只在 `build()` 时一次性设置面板状态，不监听 `chrome.storage.onChanged`。用户从 popup 调整了值、或其他 tab 改了值，当前环面板看不到。
**后果**：打开面板看到的是旧值，跟实际运行值不一致。
**✅ 正确**：交互面板必须维护 `syncPanelUI()` 函数，在 build 后 / 每次更新后 / storage.onChanged 内三处调用。

### 坑 15：面板值只写 storage、不用 postMessage 通知业务 script

**❌ 错误**：环改了 storage key，但依赖业务 content script 在 `init()` 时读一次（不会在运行时自动重新读）。其他页面下次打开才生效，当前页面不变。
**后果**：用户调了速度，视频倍速不变——因为 videoSpeed.js 只在 onload 时读一次 storage。
**✅ 正确**：环不仅写 storage（持久化），还要发 `window.postMessage` 给同页面的业务 script 让其立即生效。详见 Interactive 控制面板环的 postMessage 段。

---

## 视觉同步关键（多文件，效果一致）

多个圆环是**独立的 content script 文件**，但用户感知是"一组协调的圆环"。视觉同步靠这几条：

1. **共享浮现触发**：`window.__tabboardSideReveal` 幂等注册一次 mousemove，鼠标靠近右边缘时**同时**给 `body` 和**所有** host 加 `.near`（`:host(.near)` 响应）。一个圆环文件注册，全局生效。
2. **统一 transition 参数**：所有圆环 trigger 用 `right 220ms ease, opacity 180ms ease`，panel 用 `transform 240ms cubic-bezier(.16,1,.3,1)`。参数一致 = 动效完全同步。
3. **统一位置公式**(基于双 CSS 变量):`top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`。N 由 `__tabboardRingOrder.recompute()` 动态派发,关闭其他 ring 后自动重排(0,1,2...连续)。trigger 和 panel **必须同 top**。完整机制见 `references/ring-order-auto-fill.md`。
4. **统一收起逻辑**：每个圆环 `setTimeout(0)` 绑 document click，点外部收起；事件 retarget 到 host，`wrapper.contains(e.target)` 判断成立。

> 这四条缺任何一条，多圆环就会出现"一个先出一个后出""间距不对""hover 这个那个没反应"。

---

## 可选优化：抽公共 setup 文件

圆环多了之后，每个文件复制那 6 行幂等块也烦。可以建 `content/_sideReveal.js` 先注入：

```js
// content/_sideReveal.js —— 在 manifest 里排在所有圆环文件最前
window.setupSideReveal = function () {
  if (window.__tabboardSideReveal) return;
  window.__tabboardSideReveal = true;
  document.addEventListener('mousemove', (e) => {
    const near = e.clientX > window.innerWidth - 40;
    document.body.classList.toggle('tabboard-side-near', near);
    document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])')
      .forEach(host => host.classList.toggle('near', near));
  });
};
```

之后每个圆环文件只需 `window.setupSideReveal?.()` 一行。当前 LC/VP 用的是内联幂等版，效果等价，按需切换。

---

## 检查清单

### 基础
- [ ] 新建独立 `content/xxxSidebar.js`，没塞进别的圆环文件
- [ ] `WRAPPER_ID` 唯一（host id，主文档可见）
- [ ] trigger 和 panel 用**同一份** `top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`(双变量自动补位)
- [ ] **Shadow DOM 装配**：`attachShadow`，style + trigger + panel 都进 shadow
- [ ] host 自身样式/变量/状态用 `:host` / `:host(.expanded)` / `:host(.near)`，**不用 `#host-id`**
- [ ] **`:host` 不要加 `transform`**(会创建 containing block，多 ring 拖动场景下其他 ring 坐标系错乱)
- [ ] `--accent` 等 CSS 变量定义在 `:host` 上
- [ ] trigger 只放单一标识，无进度/计数装饰
- [ ] 近场浮现用 `:host(.near)`，mousemove 幂等注册（`window.__tabboardSideReveal`）且**同时 toggle body 和所有 host 的 .near**
- [ ] transition 参数和现有圆环一致（`right 220ms / opacity 180ms`，动效统一）
- [ ] 点击外部收起，`setTimeout(0)` 延一帧绑；`wrapper.contains(e.target)` 判断（retarget 后仍成立）
- [ ] 主文档查询 shadow 子树走 `wrapper.shadowRoot`，不用 `document.getElementById(panel)`
- [ ] `:host` 显式设 `font-family`（防宿主字体穿透）
- [ ] 写 settings 用 `updateSettings` action（合并语义），不直接 set
- [ ] **接入 master 总开关**：init 检查 `ringSidebarEnabled === false` 不显示；监听关→`remove()` DOM、开→`build()`
- [ ] master 判断用 `=== false`（undefined 默认开，向后兼容老用户）
- [ ] popup 里新增子 checkbox 放在「注入DOM控制」专区，class 为 `ring-sub`（master 关时不应能点）
- [ ] 刷新扩展 **且** 强刷测试页面

### 自动补位(必做,否则关闭其他 ring 后留下 52px 间隙)
- [ ] manifest 把新 ring 加到 `content/shared/ring-order.js` + `content/shared/draggable-ring.js` 之后的列表里
- [ ] `__tabboardRingOrder.register({ ringId, host: wrapper, defaultOrder, isAlive })` 在 `appendChild` 之后调
- [ ] `isAlive` 先查 `document.getElementById(WRAPPER_ID)`,再读 `getLastSettings()` 缓存
- [ ] `ringId` 字符串在所有 ring 间唯一
- [ ] `defaultOrder` 与 manifest 列表顺序一致(从 0 开始,不能跳号)

### 拖动(可选)
- [ ] `__tabboardRingDrag.attach(trigger, panel, wrapper, { defaultOrder, ringId })` 4 参调用
- [ ] 第三个参数是 host(`wrapper`),**不是 trigger**
- [ ] 第二个参数 `opts.ringId` 与 register 的 ringId 一致(拖动查动态序号要用)
提价