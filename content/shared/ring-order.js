/**
 * Ring Order Coordinator — 多圆环垂直自动补位
 *
 * 问题：每个 ring 原本硬编码 ringIndex(0/1/2/3) + calc(50% + 52*N px)。
 * 关闭中间一个(例 LC)→ 剩下 ring 的 N 不重算,留下 52px 永远空缺。
 *
 * 解法：
 *   1. 每个 ring 在 build() 末尾 register({ ringId, host, defaultOrder, isAlive })
 *   2. 共享 CSS 变量 --ring-order;ring 的 #trigger / #panel 用
 *      top: calc(50% + 52px * var(--ring-order, 0))
 *   3. recompute():统计存活 ring,按 defaultOrder 升序,给存活的连续派发 0,1,2...
 *   4. 触发时机：register 时、settings 变化时
 *
 * 必须在 manifest 里排在所有 ring content script **最前**,保证 window.__tabboardRingOrder
 * 在 ring build() 之前就绪。
 */
(function () {
  'use strict';

  // 共享注册表
  window.__tabboardRingRegistry = window.__tabboardRingRegistry || [];

  // 最近一次 settings 缓存(由 storage.onChanged 维护)
  // ring 的 isAlive 闭包直接读 window.__tabboardLastSettings,避免每次 getSettings 走 message passing
  var lastSettings = {};

  window.__tabboardRingOrder = {
    /**
     * 注册一个 ring
     * @param {Object} cfg
     * @param {string} cfg.ringId      - 唯一 ID,如 'lc' / 'vp' / 'timer' / 'capture'
     * @param {Element} cfg.host       - 圆环 host(主文档可见,带 id="tabboard-xxx-sidebar")
     * @param {number} cfg.defaultOrder - manifest 注册顺序(0,1,2,3...),升序连续
     * @param {Function} cfg.isAlive   - 闭包,() => bool,返回 ring 是否应参与排布
     */
    register(cfg) {
      if (!cfg || !cfg.ringId || !cfg.host || typeof cfg.defaultOrder !== 'number' || typeof cfg.isAlive !== 'function') {
        console.warn('[ring-order] register: invalid cfg', cfg);
        return;
      }
      // dedup 策略:
      //   - 找到同 ringId 的旧 entry,若 host 还活着 → 真是重复,跳过
      //   - 若旧 host 已 detached → 替换(让新 build 的 host 拿到 --ring-order)
      //   - 否则 push
      const existing = window.__tabboardRingRegistry.find(function (r) { return r.ringId === cfg.ringId; });
      if (existing) {
        if (existing.host === cfg.host) return; // 同一 host,真重复
        if (existing.host && existing.host.isConnected) return; // 旧 host 还活着,不应重 register
        // 旧 host 已 detached,替换
        existing.host = cfg.host;
        existing.defaultOrder = cfg.defaultOrder;
        existing.isAlive = cfg.isAlive;
      } else {
        window.__tabboardRingRegistry.push({
          ringId: cfg.ringId,
          host: cfg.host,
          defaultOrder: cfg.defaultOrder,
          isAlive: cfg.isAlive
        });
      }
      // 注册即排一次
      this.recompute();
    },

    /**
     * 重新计算所有存活 ring 的 --ring-order,按 defaultOrder 升序连续派发
     */
    recompute() {
      // 1. 清理已不存在或已死的 host(防止主文档残留)
      window.__tabboardRingRegistry = window.__tabboardRingRegistry.filter(function (r) {
        return r.host && r.host.isConnected;
      });

      // 2. 取出存活的,按 defaultOrder 升序
      var alive = window.__tabboardRingRegistry
        .filter(function (r) { return r.isAlive(); })
        .sort(function (a, b) { return a.defaultOrder - b.defaultOrder; });

      // 3. 连续派发
      alive.forEach(function (r, i) {
        r.host.style.setProperty('--ring-order', String(i));
      });
    },

    /**
     * 暴露给外部:写入最新 settings(供 ring 的 isAlive 闭包查询)
     * 也供 draggable-ring 等模块查询当前顺序
     */
    getLastSettings: function () { return lastSettings; },

    /**
     * 暴露给外部:查询某 ringId 的当前 order(供 draggable-ring 联动)
     * 若该 ringId 不在注册表(已死)则返回 -1
     */
    getCurrentOrder: function (ringId) {
      // 找出该 ring 当前在 alive 列表的索引
      var alive = window.__tabboardRingRegistry
        .filter(function (r) { return r.isAlive(); })
        .sort(function (a, b) { return a.defaultOrder - b.defaultOrder; });
      for (var i = 0; i < alive.length; i++) {
        if (alive[i].ringId === ringId) return i;
      }
      return -1;
    }
  };

  // 监听 settings 变化 → 缓存 + 触发重排
  // 各 ring 的 onChanged 监听器会同时跑 build/remove。recompute 必须在它们之后。
  // 这里用 setTimeout(0) 推到下一帧,等各 ring 的 build/remove 完成
  chrome.storage.onChanged.addListener(function (changes, ns) {
    if (ns !== 'local' || !changes.settings) return;
    lastSettings = changes.settings.newValue || {};
    setTimeout(function () {
      window.__tabboardRingOrder.recompute();
    }, 0);
  });

  // 初始化时主动拉一次 settings,作为初始缓存
  try {
    chrome.runtime.sendMessage({ action: 'getSettings' }, function (res) {
      if (res && res.success && res.settings) {
        lastSettings = res.settings;
      }
    });
  } catch (e) {}
})();

