/**
 * Goto Ring — 悬浮圆形快捷菜单
 * 在所有页面右下角显示一个可拖动的圆环，hover 展开成辐射式菜单
 * 依赖 chrome.storage.local 中 settings.showGotoRing
 *
 * 数据来源：从 groups 中找到 goto=true 的 group,圆环动态从该 group 的 tabs
 * 中取前 6 个 tab 渲染菜单项;由 background/groups.js 的 setGroupAsGoto
 * 控制哪个 group 是 goto 源。
 */

(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-goto-ring';

  // 空菜单（兜底：仅在 extension context 不可用时使用）
  const EMPTY_MENU = { name: 'goto', isRoot: true, children: [] };

  // 防止重复注入
  if (window.__tabboardGotoRingInjected) {
    return;
  }
  window.__tabboardGotoRingInjected = true;

  // ===================== 状态 =====================
  let isEnabled = false;
  let wrapper = null;
  let styleEl = null;
  let menuData = EMPTY_MENU;
  let isActive = false;
  let isDragging = false;
  let currentMenuItems = [];
  let activeSubmenus = [];
  let offsetX = 0;
  let offsetY = 0;

  // ===================== 样式 =====================
  const STYLES = `
    #${WRAPPER_ID} {
      position: fixed;
      bottom: 100px;
      right: 100px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #${WRAPPER_ID}-circle {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: white;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
      user-select: none;
      font-weight: bold;
      color: #667eea;
      font-size: 24px;
      border: 3px solid #667eea;
    }
    #${WRAPPER_ID}-circle:hover {
      transform: scale(1.1);
    }
    #${WRAPPER_ID}-circle.active {
      background: #ff4757;
      color: white;
      border-color: #ff4757;
    }
    .${WRAPPER_ID}-item {
      position: fixed;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: white;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      opacity: 0;
      transform: scale(0);
      transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
      font-size: 11px;
      color: #667eea;
      font-weight: 500;
      z-index: 999998;
      pointer-events: none;
      text-align: center;
      padding: 5px;
      box-sizing: border-box;
      word-wrap: break-word;
    }
    .${WRAPPER_ID}-item.show {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }
    .${WRAPPER_ID}-item:hover {
      background: #667eea;
      color: white;
      transform: scale(1.15);
      z-index: 1000000;
    }
  `;

  // ===================== 工具 =====================
  function getCircleCenter() {
    const circle = document.getElementById(WRAPPER_ID + '-circle');
    if (!circle) return { x: 0, y: 0 };
    const rect = circle.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  // ===================== 打开 URL（与 background openUrl 行为一致） =====================
  function handleUrlNavigation(url) {
    if (!url) return;
    try {
      const target = new URL(url);
      // 优先复用同域 path 前缀的标签页
      chrome.runtime.sendMessage({ action: 'openUrl', url: target.href }, () => {
        // 关闭菜单
        if (isActive) collapseMenu();
      });
    } catch (e) {
      // 非法 URL 直接新开
      window.open(url, '_blank');
      if (isActive) collapseMenu();
    }
  }

  // ===================== DOM 构建 =====================
  function buildRing() {
    if (wrapper) return; // 守卫：避免重复创建

    // 注入样式（去重）
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = WRAPPER_ID + '-styles';
      styleEl.textContent = STYLES;
      document.head.appendChild(styleEl);
    }

    wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;

    // 还原上次位置
    const savedPos = JSON.parse(localStorage.getItem('tabboardGotoRingPos') || '{}');
    if (savedPos.left && savedPos.top) {
      wrapper.style.left = savedPos.left;
      wrapper.style.top = savedPos.top;
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
    }

    const circle = document.createElement('div');
    circle.id = WRAPPER_ID + '-circle';
    circle.innerHTML = '☰';
    circle.title = '悬浮激活菜单';
    wrapper.appendChild(circle);
    document.body.appendChild(wrapper);

    bindRingEvents(circle);
  }

  function removeRing() {
    if (wrapper) {
      wrapper.remove();
      wrapper = null;
    }
    if (styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  // ===================== 事件绑定 =====================
  function bindRingEvents(circle) {
    // 拖动
    circle.addEventListener('mousedown', (e) => {
      if (!isActive) {
        isDragging = true;
        const rect = wrapper.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        document.body.style.userSelect = 'none';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        const maxX = window.innerWidth - wrapper.offsetWidth;
        const maxY = window.innerHeight - wrapper.offsetHeight;
        const clampedX = Math.max(0, Math.min(x, maxX));
        const clampedY = Math.max(0, Math.min(y, maxY));
        wrapper.style.left = `${clampedX}px`;
        wrapper.style.top = `${clampedY}px`;
        wrapper.style.right = 'auto';
        wrapper.style.bottom = 'auto';
        wrapper.style.position = 'fixed';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
        localStorage.setItem('tabboardGotoRingPos', JSON.stringify({
          left: wrapper.style.left,
          top: wrapper.style.top
        }));
      }
    });

    // hover 展开
    circle.addEventListener('mouseenter', () => {
      if (isDragging || isActive) return;
      expandMenu(circle);
    });

    // 点击关闭
    circle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isDragging) return;
      if (isActive) collapseMenu();
    });

    // 页面其他位置点击关闭
    document.addEventListener('click', (e) => {
      if (!wrapper) return;
      if (!wrapper.contains(e.target) &&
        !e.target.classList.contains(WRAPPER_ID + '-item')) {
        if (isActive) collapseMenu();
      }
    });

    // 滚动时自动关闭
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (isActive) collapseMenu();
      }, 50);
    });
  }

  // ===================== 菜单展开/收起 =====================
  function expandMenu(circle) {
    isActive = true;
    circle.classList.add('active');
    circle.innerHTML = '✕';
    circle.title = '点击关闭菜单';
    clearMenuItems();
    showMenuItems(menuData.children);
  }

  function collapseMenu() {
    const circle = document.getElementById(WRAPPER_ID + '-circle');
    if (!circle) return;
    isActive = false;
    circle.classList.remove('active');
    circle.innerHTML = '☰';
    circle.title = '悬浮激活菜单';
    clearMenuItems();
  }

  function showMenuItems(items) {
    clearMenuItems();
    const center = getCircleCenter();
    const radius = 80;
    const angleStep = (Math.PI * 2) / items.length;

    items.forEach((item, index) => {
      // 向左旋转 90°，让第一个项目显示在最左侧
      const angle = angleStep * index - Math.PI;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const menuItem = createMenuItem(item, center, x, y);
      document.body.appendChild(menuItem);
      currentMenuItems.push(menuItem);

      setTimeout(() => menuItem.classList.add('show'), index * 50);

      // 悬停时展开子菜单
      menuItem.addEventListener('mouseenter', () => {
        clearSubmenus();
        if (item.children && item.children.length > 0) {
          showSubmenu(item.children, menuItem, angle);
        }
      });
    });
  }

  function createMenuItem(item, center, x, y) {
    const menuItem = document.createElement('div');
    menuItem.className = WRAPPER_ID + '-item';
    menuItem.textContent = item.name;
    menuItem.style.left = `${center.x - 25 + x}px`;
    menuItem.style.top = `${center.y - 25 + y}px`;

    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.url) {
        handleUrlNavigation(item.url);
      }
    });

    return menuItem;
  }

  function showSubmenu(items, parentElement, parentAngle) {
    const rect = parentElement.getBoundingClientRect();
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    const radius = 80;
    const spread = Math.PI; // 半圆
    const startAngle = parentAngle - spread / 2;
    const endAngle = parentAngle + spread / 2;
    const angleStep = (endAngle - startAngle) / Math.max(items.length - 1, 1);

    items.forEach((item, index) => {
      const angle = startAngle + index * angleStep;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const submenuItem = createMenuItem(item, center, x, y);
      document.body.appendChild(submenuItem);
      activeSubmenus.push(submenuItem);

      setTimeout(() => submenuItem.classList.add('show'), index * 50);
    });
  }

  function clearSubmenus() {
    activeSubmenus.forEach(item => {
      item.classList.remove('show');
      requestAnimationFrame(() => setTimeout(() => item.remove(), 200));
    });
    activeSubmenus = [];
  }

  function clearMenuItems() {
    currentMenuItems.forEach(item => {
      item.classList.remove('show');
      requestAnimationFrame(() => setTimeout(() => item.remove(), 200));
    });
    currentMenuItems = [];
    clearSubmenus();
  }

  // ===================== 数据加载 =====================
  // 圆环菜单动态计算：从 groups 找到 goto=true 的 group,拉取该 group 的前 5 个 tab
  async function loadMenuDataFromStorage() {
    try {
      const [groupsRes, tabsRes] = await Promise.all([
        chrome.storage.local.get(['groups']),
        chrome.storage.local.get(['tabs'])
      ]);

      const groups = (groupsRes && groupsRes.groups) || [];
      const allTabs = (tabsRes && tabsRes.tabs) || {};
      const gotoGroups = groups.filter(g => g.goto === true);

      if (gotoGroups.length === 0) {
        menuData = EMPTY_MENU;
        return;
      }

      // 标题截断到 7 字符(圆环 50px 圆点的可视范围)
      const truncate = (s, n = 7) => (s && s.length > n ? s.slice(0, n) : (s || ''));

      const subGroups = gotoGroups.map(g => {
        const groupTabs = (allTabs[g.id] || []).slice(0, 6);
        const items = groupTabs
          .filter(t => t && t.url)
          .map(t => ({
            name: truncate(t.title || t.url, 7),
            url: t.url,
            children: []
          }));
        return {
          name: truncate(g.name || '📄 面包', 7),
          children: items
        };
      }).filter(g => g.children.length > 0);

      menuData = {
        name: 'goto',
        isRoot: true,
        children: subGroups
      };
    } catch (err) {
      // Extension context may be invalid; keep EMPTY_MENU
    }
  }

  // ===================== 初始化 =====================
  async function init() {
    try {
      const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
      isEnabled = !!settings.showGotoRing;

      if (!isEnabled) {
        removeRing();
        return;
      }
      await loadMenuDataFromStorage();
      buildRing();
    } catch (err) {
      // Extension context may be invalid
    }
  }

  // ===================== 设置变更监听 =====================
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.settings) {
      const newSettings = changes.settings.newValue || {};
      const newEnabled = !!newSettings.showGotoRing;
      if (newEnabled !== isEnabled) {
        isEnabled = newEnabled;
        if (isEnabled) init();
        else removeRing();
      }
    }
    if (changes.tabs || changes.groups) {
      // 源 group 的 tabs 或 groups 本身变化时,刷新内存中的数据
      loadMenuDataFromStorage();
    }
  });

  // ===================== 后端主动推送刷新 =====================
  chrome.runtime.onMessage.addListener((request) => {
    if (request && request.action === 'refreshGotoRing') {
      loadMenuDataFromStorage();
    }
    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
