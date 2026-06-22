# Shadow DOM 隔离 — 注入 UI 防 CSS reset / 类名撞车

> 配套 `hover-reveal.md`。那篇讲 hover-reveal 机制,这篇讲**为什么以及怎么用 Shadow DOM 把注入 UI 和宿主页彻底隔离**。

## 为什么必须用 Shadow DOM

宿主页(Notion / Linear / Figma / 各类 SaaS)常用激进全站 CSS:
- `* { all: revert }` / `* { margin:0; padding:0 }`
- `body > div { ... }`、`[class*="item"] { ... }` 这类高优先级/属性选择器
- 自定义 element reset

普通注入的 UI(样式注进 `<head>`、元素挂 `document.body`)会被这些规则**穿透**,表现为"圆环偶尔 CSS 完全失效""类名撞车被覆盖""蓝色没了"。

Shadow DOM 把样式封装在 shadow root 内,**宿主页的 CSS 100% 不可达**,这是 Chrome 扩展注入 UI 的标准最佳实践。代价:主文档的 `getElementById`/`querySelector` 查不到 shadow 子树,DOM 查询要改走 `wrapper.shadowRoot`。

## 装配骨架(content script)

```javascript
function build() {
  if (document.getElementById(WRAPPER_ID)) return;

  // host 挂在主文档 body；trigger + panel + style 全装进 Shadow Root
  const wrapper = document.createElement('div');
  wrapper.id = WRAPPER_ID;
  const shadow = wrapper.attachShadow({ mode: 'open' });

  // 样式注入 shadow 内（不是 document.head）
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  // trigger / panel 都 append 到 shadow，不是 wrapper
  const trigger = document.createElement('div');
  // ...
  shadow.appendChild(trigger);

  const panel = document.createElement('div');
  // ...
  shadow.appendChild(panel);

  document.body.appendChild(wrapper);  // host 最后挂到 body
}
```

## 六个必踩的坑（按踩的频率排序）

### 坑 1：选 host 自身必须用 `:host`，不能用 `#id`

**❌** `#tabboard-lc-sidebar.expanded #tabboard-lc-sidebar-panel`
**后果**：shadow 内 `#host-id` 选不到 host（host 是 shadow root，不是自己的后代），`.expanded` 加上后 panel 永远不显示 → 看起来"点了没反应"。
**✅** `:host(.expanded) #tabboard-lc-sidebar-panel`

> 规律：**shadow 内凡是"选 host 自身"的规则（定位、状态、变量定义），一律 `:host` / `:host(.state)`，禁止 `#host-id`。** 这是最高频坑。

### 坑 2：CSS 变量定义到 `:host`，不是 `#id`

**❌**
```css
#tabboard-lc-sidebar { --accent: #42a5f5; }
.lc-trigger-icon { color: var(--accent); }   /* 失效，取不到值 */
```
**后果**：`--accent` 没定义成功，所有 `var(--accent)` 失效，蓝色（图标/按钮/开关/hover）全没。
**✅**
```css
:host { --accent: #42a5f5; }
```

### 坑 3：跨 shadow boundary 的外部状态用 `:host(.state)`，JS 同步加 class

宿主页的 hover/位置状态（如"鼠标靠近右边缘"）发生在主文档，shadow 内的 CSS 看不到 `body.some-class`。

**❌** `body.tabboard-side-near #trigger { ... }`（body 在 shadow 外，选不到 trigger）
**✅** 两步：
1. CSS：`:host(.near) #trigger { right: 8px; opacity: 1; }`
2. JS（主文档 mousemove，幂等注册一次）：同时 toggle `body` 和每个 host 的 class：
```javascript
if (!window.__tabboardSideReveal) {
  window.__tabboardSideReveal = true;
  document.addEventListener('mousemove', (e) => {
    const near = e.clientX > window.innerWidth - 40;
    document.body.classList.toggle('tabboard-side-near', near);
    document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])')
      .forEach(host => host.classList.toggle('near', near));
  });
}
```

### 坑 4：主文档查 shadow 子树 → 走 `wrapper.shadowRoot`

**❌** `document.getElementById(WRAPPER_ID + '-panel')` → 返回 null（panel 在 shadow 内）
**✅**
```javascript
const wrapper = document.getElementById(WRAPPER_ID);
const panel = wrapper.shadowRoot.getElementById(WRAPPER_ID + '-panel');
```
> 注意 `wrapper` 本身（host）在主文档，`document.getElementById(WRAPPER_ID)` 能查到；只有它的**子树**在 shadow 内。

### 坑 5：事件 retarget —— `e.target` 是 host，不是 shadow 内元素

主文档的 `click` listener 里，`e.target` 是 host（wrapper），不是 shadow 内真正被点的元素（事件穿过 boundary 时被 retarget）。

**影响**：点击外部收起的判断 `wrapper.contains(e.target)` **仍然正确**（点 shadow 内任何元素，retarget 后 `e.target === host`，`wrapper.contains(host)` 为 true）。但要记住：你拿不到具体的 shadow 内 target。

**✅** 判断"点在不在圆环内"用 `wrapper.contains(e.target)`；具体元素逻辑在 shadow 内的 listener 里处理（那里 `e.target` 是真实元素）。

### 坑 6：可继承属性会从宿主穿透进来

`font-family` / `color` / `font-size` 等**可继承属性**从宿主 `<body>` 穿透 shadow boundary。如果宿主 `body { font-family: serif }`，shadow 内没显式设字体的元素会变 serif。

**✅** 在 `:host` 或根元素显式设 `font-family` / `color` / `font-size`，别依赖默认。

## 错误样本汇总

| ❌ 错误 | 后果 | ✅ 正确 |
|--------|------|--------|
| `style` 注入 `document.head` | 宿主 CSS 仍可影响（且污染宿主） | 注入 `shadow.appendChild(style)` |
| `trigger`/`panel` 挂 `wrapper`（普通子） | 无隔离，等于没用 shadow | `shadow.appendChild(...)` |
| `#host-id { ... }` 设 host 样式/变量 | shadow 内选不到 host | `:host { ... }` |
| `#host-id.expanded #panel` | 状态不响应 | `:host(.expanded) #panel` |
| `body.near #trigger` | body 在 shadow 外 | `:host(.near) #trigger` + JS 同步 host class |
| `document.querySelector('#panel ...')` | 返回 null | `wrapper.shadowRoot.querySelector(...)` |
| 不设 `:host { font-family }` | 宿主字体穿透进来 | 显式设 |

## 检查清单

- [ ] `attachShadow({ mode: 'open' })` 装配，style + trigger + panel 都进 shadow
- [ ] host 自身样式/变量用 `:host`，不用 `#id`
- [ ] 状态联动用 `:host(.state)` + JS 在主文档 mousemove 里同步 host class
- [ ] 主文档 DOM 查询走 `wrapper.shadowRoot`
- [ ] `:host` 显式设 `font-family`/`color`/`font-size`（防穿透）
- [ ] 点击外部判断用 `wrapper.contains(e.target)`（retarget 后仍正确）
- [ ] 多圆环：mousemove 靠 `window.__tabboardSideReveal` 幂等注册，一次 toggle 所有 host
