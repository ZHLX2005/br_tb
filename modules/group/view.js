/**
 * GroupView - 分组视图模块
 * 负责分组看板的渲染和交互
 */

import { escapeHtml, formatTime, getColorClass } from '../shared/utils.js';
import { modal } from '../../shared/ModalDialog.js';
import { serializeGroupsToToml, parseGroupsToml, buildAiPrompt } from './toml.js';

class GroupView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.groups = [];
    this.tabs = {};
    this.kanban = null;
    this.boardActionsObserver = null;
    // 【看板高度】高度由 JS 按视口算成固定 px,需跟着 resize/缩放重算;
    // 下面三个字段支撑 _bindBoardHeightAutoSync / _unbindBoardHeightAutoSync
    this._heightSyncBound = false;   // resize 监听是否已挂(只挂一次,防重复累积)
    this._heightObserver = null;     // ResizeObserver 实例
    this._heightSyncRaf = null;      // 待执行的 rAF,用于合并连续的 resize 事件
    this.visibleGroups = new Set(); // 存储可见分组的 ID
    // 【ns】命名空间状态:从 settings.activeNamespace 缓存当前活跃 ns,
    // availableNamespaces 列出已知 ns(用于下拉框选项)。渲染时直接读这两个属性,
    // 跨源切 ns(popup / content script)的同步由 tabboard.js 的 storage.onChanged
    // 监听器触发 updateData() + render(),此处不再额外注册 listener。
    this.activeNamespace = 'default';
    this.availableNamespaces = ['default'];
    // 启动时异步拉一次,确保下拉框选项尽量完整(若 message 不可用,降级为仅 active)
    this._refreshAvailableNamespaces();
  }

  /**
   * 更新数据
   */
  updateData(data) {
    this.groups = data.groups || [];
    this.tabs = data.tabs || {};
    // 可见性已迁移为 group.visible 属性(原 settings.visibleGroups,见 background/group-model.js)
    this._refreshVisibleGroups();
    // 【ns】从 settings.activeNamespace 同步当前 ns;同步刷新下拉框候选(异步)
    if (data.settings && typeof data.settings.activeNamespace === 'string') {
      this.activeNamespace = data.settings.activeNamespace;
      if (!this.availableNamespaces.includes(this.activeNamespace)) {
        this.availableNamespaces = [...this.availableNamespaces, this.activeNamespace];
      }
    }
    this._refreshAvailableNamespaces();
  }

  /**
   * 【ns】异步拉取所有 ns 下的 group,聚合出 ns 集合。
   * 调用 getAllGroupsAcrossNamespaces 消息(若 adapter 尚未实现则忽略错误,
   * 候选退化为仅当前 active)。
   * 注意:严格遵守 CLAUDE.md 规约,不直接 chrome.storage.local.get(['groups'])。
   * 单 ns ⇄ 多 ns 的翻转会改变切换器显隐(单 ns 不渲染徽章/chips),
   * 异步刷新确认后补一次重渲染;显隐未变则不打扰。
   */
  async _refreshAvailableNamespaces() {
    try {
      const result = await this.dataManager.sendMessage('getAllGroupsAcrossNamespaces');
      const allGroups = result?.groups;
      const nsSet = new Set([this.activeNamespace]);
      if (Array.isArray(allGroups)) {
        for (const g of allGroups) {
          if (g && typeof g.ns === 'string') nsSet.add(g.ns);
        }
      }
      // 兜底:「default」永远在选项里 —— 老用户数据可能缺 ns 字段,
      // 或用户曾清空数据,否则切到新 ns 后再切不回 default
      nsSet.add('default');
      const next = Array.from(nsSet).sort();
      const prev = this.availableNamespaces;
      const same = prev.length === next.length && prev.every((n, i) => n === next[i]);
      const prevSingle = prev.length <= 1;
      const nextSingle = next.length <= 1;
      this.availableNamespaces = next;
      if (!same && prevSingle !== nextSingle && this._renderReady) {
        const data = await this.dataManager.loadData();
        this.updateData(data);
        this.render();
      }
    } catch (err) {
      // action 尚未在 adapter 注册时静默降级,不影响主流程
      // (开发期可在 console 看到 warn,生产环境忽略)
      if (err && !/Unknown action/i.test(String(err.message || err))) {
        console.warn('[GroupView] refresh namespaces failed:', err);
      }
    }
  }

  /**
   * 【ns】返回下拉框候选 ns 列表
   */
  _getAvailableNamespaces() {
    return this.availableNamespaces;
  }

  /**
   * 从 group.visible 派生 Set 缓存(替代旧 settings.visibleGroups)
   */
  _refreshVisibleGroups() {
    this.visibleGroups = new Set(
      this.groups.filter(g => g.visible !== false).map(g => g.id)
    );
  }

  /**
   * 获取可见分组列表
   */
  _getVisibleGroups() {
    return this.groups.filter(group => this.visibleGroups.has(group.id));
  }

  /**
   * 渲染看板
   */
  render() {
    // 标记已渲染过:异步 ns 集合刷新在「单 ns ⇄ 多 ns」翻转时据此补一次重渲染
    this._renderReady = true;

    const emptyState = document.getElementById('emptyState');
    const stats = document.getElementById('stats');
    const tabboard = document.getElementById('tabboard');

    // 计算总标签数
    const totalTabs = Object.values(this.tabs).flat().length;
    const visibleGroups = this._getVisibleGroups();
    stats.textContent = `${totalTabs} 个标签页 · ${visibleGroups.length}/${this.groups.length} 个分组显示`;

    // 即使当前 ns 没有任何分组,也保留工具栏(AI导入 / TOML导入 / JSON 导入
    // 是冷启动主入口),空态以工具栏下方的内联提示呈现,不再切到 #emptyState。
    emptyState.style.display = 'none';

    // 【ns】命名空间切换器,放在操作按钮区最前。识别优先 + 下拉式:
    // 当前 ns 以高权重徽章展示,全部 ns 的 chips 收进「点击徽章展开」的下拉面板,
    // 「＋ 新建命名空间」是面板底部条目,点击后才展开输入行。
    // 仅 ≥2 个 ns 时渲染徽章;单 ns(只有 default)不渲染徽章 —— 没有可识别的上下文,
    // 给它们权重反而与「+ 添加分组」「打开全部」等分组操作冲突,只留一个低调的
    // 「＋ 新建命名空间」入口(创建出第二个 ns 后 render 自动升级)。
    // 结构与 popup 保持一致(modules/popup/modules/groups.js loadNamespaces 同一处结构)。
    // ⚠️ 不再挂 datalist:<input list> 会和 Chrome 自身的表单历史 autofill 下拉冲突。
    // ⚠️ 外层必须包一个纵向 wrapper:.board-actions-header 是横向 flex 容器;
    //    下拉面板 absolute 定位,打开时悬浮不撑高工具栏。
    const availableNamespaces = this._getAvailableNamespaces();
    const nsSwitcherHtml = availableNamespaces.length > 1 ? `
      <div class="ns-switcher-wrap">
        <div class="ns-switcher">
          <button id="board-ns-badge" class="ns-badge" title="当前命名空间「${escapeHtml(this.activeNamespace)}」,点击切换">
            <span class="ns-badge-dot"></span>
            <span id="board-ns-badge-name" class="ns-badge-name">${escapeHtml(this.activeNamespace)}</span>
            <span class="ns-badge-caret">▾</span>
          </button>
        </div>
        <div class="ns-panel" id="board-ns-panel" hidden>
          <div class="ns-chips" id="board-ns-chips">
            ${availableNamespaces.map(ns => `
              <button class="ns-chip${ns === this.activeNamespace ? ' active' : ''}" data-ns="${escapeHtml(ns)}" title="切换到「${escapeHtml(ns)}」">
                ${escapeHtml(ns)}
              </button>
            `).join('')}
          </div>
          <button id="board-ns-new-single" class="ns-switcher-new-single" title="新建命名空间">＋ 新建命名空间</button>
          <div class="ns-create" id="board-ns-create" hidden>
            <input id="board-ns-input" class="ns-switcher-input" autocomplete="nope" autocorrect="off" autocapitalize="off" spellcheck="false"
              name="__tabboard_ns_input"
              placeholder="输入新 ns 名,按 Enter 创建" />
            <button id="board-ns-apply" class="ns-switcher-apply" title="创建该命名空间">应用</button>
          </div>
        </div>
      </div>
    ` : `
      <div class="ns-switcher-wrap">
        <div class="ns-switcher ns-single">
          <button id="board-ns-new-single" class="ns-switcher-new-single" title="新建命名空间">＋ 新建命名空间</button>
        </div>
        <div class="ns-panel ns-panel-inline" id="board-ns-panel" hidden>
          <div class="ns-create" id="board-ns-create" hidden>
            <input id="board-ns-input" class="ns-switcher-input" autocomplete="nope" autocorrect="off" autocapitalize="off" spellcheck="false"
              name="__tabboard_ns_input"
              placeholder="输入新 ns 名,按 Enter 创建" />
            <button id="board-ns-apply" class="ns-switcher-apply" title="创建该命名空间">应用</button>
          </div>
        </div>
      </div>
    `;

    // 添加操作按钮区域
    const actionsHeader = document.createElement('div');
    actionsHeader.className = 'board-actions-header';
    actionsHeader.innerHTML = `
      ${nsSwitcherHtml}
      <button class="board-action-btn add-group-btn" title="添加新分组">+ 添加分组</button>
      <button class="board-action-btn filter-groups-btn" title="选择要显示的分组">筛选</button>
      <button class="board-action-btn refresh-sort-btn" title="按点击次数刷新排序">刷新排序</button>
      <button class="board-action-btn open-all-groups-btn" title="打开所有分组">打开全部</button>
      <button class="board-action-btn import-bookmarks-btn" title="从浏览器书签导入">导入书签</button>
      <button class="board-action-btn toml-export-btn" title="把当前分组收藏导出为 TOML 文件">导出</button>
      <button class="board-action-btn toml-ai-btn" title="复制 AI 提示词 / 粘贴 TOML 导入新分组">导入</button>
    `;

    // 清空并添加操作按钮
    tabboard.innerHTML = '';
    tabboard.appendChild(actionsHeader);

    // 当前 ns 完全没有分组:保留工具栏 + 内联引导(AI导入/TOML 是冷启动主入口)
    if (this.groups.length === 0) {
      const noGroupMsg = document.createElement('div');
      noGroupMsg.className = 'no-visible-groups-message';
      noGroupMsg.style.cssText = 'text-align: center; padding: 40px; color: #888; font-size: 14px; line-height: 2;';
      noGroupMsg.innerHTML = `
        <div>当前命名空间「${escapeHtml(this.activeNamespace)}」还没有分组</div>
        <div style="font-size:12px;color:#888;">点击「+ 添加分组」手动创建,或点击「导入」复制 AI 提示词 → 外部 AI 产出 TOML → 一键导入新分组</div>
      `;
      tabboard.appendChild(noGroupMsg);
      this._setupGroupActionButtons();
      return;
    }

    // 如果没有可见分组，显示提示
    if (visibleGroups.length === 0) {
      // 注:this.groups.length === 0 的情形已由上面的分支处理;
      // 这里只剩下「active ns 内有 group,但都被 visible=false 隐藏」一种情形。
      const noVisibleMsg = document.createElement('div');
      noVisibleMsg.className = 'no-visible-groups-message';
      noVisibleMsg.textContent = '当前没有显示的分组,请点击"筛选"按钮选择要显示的分组';
      noVisibleMsg.style.cssText = 'text-align: center; padding: 40px; color: #888; font-size: 14px;';
      tabboard.appendChild(noVisibleMsg);
      this._setupGroupActionButtons();
      return;
    }

    const boards = this._convertToJKanbanFormat(visibleGroups);

    // 销毁旧的 kanban 实例
    if (this.kanban) {
      const container = document.getElementById('tabboard');
      const boardsToRemove = container.querySelectorAll('.kanban-board');
      boardsToRemove.forEach(board => board.remove());
      this.kanban = null;
    }

    // 创建新的 kanban 实例
    this.kanban = new jKanban({
      element: '#tabboard',
      gutter: '12px',
      widthBoard: '280px',
      responsivePercentage: false,
      dragItems: true,
      dragBoards: true,
      boards: boards,
      click: (el) => this._handleItemClick(el),
      dropEl: (el, target, source, sibling) => this._handleDropEl(el, target, source, sibling),
      dragendEl: (el) => this._handleDragEndEl(el),
      buttonClick: (el, boardId) => this._handleBoardButtonClick(el, boardId),
      dropBoard: (el, target, source, sibling) => this._handleDropBoard(el, target, source, sibling),
      itemAddOptions: {
        enabled: false
      }
    });

    // 设置看板操作按钮
    this._setupBoardActions();
  }

  /**
   * 转换数据为 jKanban 格式
   */
  _convertToJKanbanFormat(groupsToConvert = this.groups) {
    return groupsToConvert.map(group => {
      const groupTabs = this.tabs[group.id] || [];

      return {
        id: group.id,
        title: group.name,
        class: `kanban-board-${getColorClass(group.color)}`,
        item: groupTabs.map(tab => {
          const visitCount = tab.visitCount || 0;
          const visitBadge = visitCount > 0 ? `<span class="kanban-item-visits" title="访问次数">${visitCount} views</span>` : '';

          return {
            id: tab.id,
            title: `
              <div class="kanban-item-content">
                <div class="kanban-item-header">
                  <img class="kanban-item-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
                  <span class="kanban-item-title">${escapeHtml(tab.title)}</span>
                  ${visitBadge}
                </div>
                <div class="kanban-item-url">${escapeHtml(tab.url)}</div>
                <div class="kanban-item-time">${formatTime(tab.timestamp)}</div>
                <button class="kanban-item-delete" data-id="${tab.id}" title="删除">×</button>
              </div>
            `,
            url: tab.url,
            timestamp: tab.timestamp
          };
        })
      };
    });
  }

  /**
   * 设置看板操作按钮
   */
  _setupBoardActions() {
    // 断开旧的 observer
    if (this.boardActionsObserver) {
      this.boardActionsObserver.disconnect();
    }

    // 立即添加一次按钮
    this._addBoardActionButtons();

    // 创建新的 observer 监听 DOM 变化
    this.boardActionsObserver = new MutationObserver((mutations) => {
      const hasNewBoards = mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(node =>
          node.nodeType === 1 && (
            node.classList?.contains('kanban-board') ||
            node.querySelector?.('.kanban-board')
          )
        )
      );

      if (hasNewBoards) {
        this._addBoardActionButtons();
      }
    });

    this.boardActionsObserver.observe(document.getElementById('tabboard'), {
      childList: true,
      subtree: true
    });

    // 设置删除按钮的事件委托
    this._setupDeleteButtons();

    // 绑定分组视图操作按钮
    this._setupGroupActionButtons();

    // 绑定看板内按钮(Open/Clear/Del/Goto)的事件委托,避免每次重渲染重复绑定导致事件堆叠
    this._setupBoardActionDelegation();

    // 看板高度是 JS 按视口算的固定 px,需在 resize / 缩放 / 容器尺寸变化时重算
    this._bindBoardHeightAutoSync();
  }

  /**
   * 看板内按钮事件委托 - 一次性绑定到 #tabboard,通过事件冒泡分发
   * 修复历史 bug: 此前每个按钮都用 .bind(this) 在 MutationObserver 触发的多次重渲染中累积监听器,
   * 导致 Clear/Del 第一次点击时弹出多个 confirm,或因状态过期而无效。
   */
  _setupBoardActionDelegation() {
    const container = document.getElementById('tabboard');
    if (!container || container.__boardActionDelegationBound) return;
    container.__boardActionDelegationBound = true;

    container.addEventListener('click', (e) => {
      const openBtn = e.target.closest('.open-all');
      if (openBtn) {
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        const groupId = openBtn.dataset.boardId;
        if (groupId) this.dataManager.sendMessage('openGroup', { groupId });
        return;
      }

      const clearBtn = e.target.closest('.clear-group');
      if (clearBtn) {
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        this._handleClearGroup({ stopPropagation: () => {}, currentTarget: clearBtn, target: clearBtn });
        return;
      }

      const delBtn = e.target.closest('.delete-group');
      if (delBtn) {
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        this._handleDeleteGroup({ stopPropagation: () => {}, currentTarget: delBtn, target: delBtn });
        return;
      }

      const gotoBtn = e.target.closest('.push-to-goto');
      if (gotoBtn) {
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        this._handlePushToGotoRing({ stopPropagation: () => {}, currentTarget: gotoBtn, target: gotoBtn });
        return;
      }
    }, true);
  }

  /**
   * 添加看板操作按钮
   */
  _addBoardActionButtons() {
    const groupView = document.getElementById('groupView');
    if (!groupView) return;

    groupView.querySelectorAll('.kanban-board').forEach(board => {
      const header = board.querySelector('.kanban-title-board');
      if (header && !header.querySelector('.board-actions')) {
        const boardId = board.getAttribute('data-id');
        const isGoto = this.groups.find(g => g.id === boardId)?.goto === true;
        const gotoText = isGoto ? 'Goto✓' : 'Goto';
        const gotoTitle = isGoto ? '已在 goto 圆环展示,点击取消' : '设为 goto 圆环展示源';
        const actions = document.createElement('div');
        actions.className = 'board-actions';
        actions.innerHTML = `
          <button class="board-action-btn open-all" data-board-id="${boardId}" title="打开所有">Open</button>
          <button class="board-action-btn clear-group" data-board-id="${boardId}" title="清空分组">Clear</button>
          <button class="board-action-btn delete-group" data-board-id="${boardId}" title="删除分组">Del</button>
          <button class="board-action-btn push-to-goto ${isGoto ? 'goto-active' : ''}" data-board-id="${boardId}" title="${gotoTitle}">${gotoText}</button>
        `;
        header.appendChild(actions);
      }
    });

    // 设置看板高度，使内容区域可以滚动
    this._syncBoardHeights();
  }

  /**
   * 按当前视口尺寸重算并下发每个看板列的高度(纯几何计算,不注入按钮)。
   *
   * 看板列高度是 JS 算出来的固定 px 值(不是 CSS 百分比),形状由“视口高度 −
   * 工具栏高度”决定。这个值只在 render / 新增看板列时算过一次,而窗口拖拽、
   * 浏览器缩放(zoom)都不改 DOM —— 没有任何事件会重算它,所以高度会一直停在
   * 旧值上,表现为“缩放后不跟手,必须点 Refresh 才更新”。
   * 重算时机由 _bindBoardHeightAutoSync() 负责。
   */
  _syncBoardHeights() {
    const groupView = document.getElementById('groupView');
    if (!groupView) return;

    // 使用 groupView 的完整高度作为基准
    const viewHeight = groupView.clientHeight;

    // 视图处于 display:none(当前切在别的 view)时 clientHeight 为 0,算出来是
    // 负值,被 200px 下限兜住后会把所有看板压成最小高度 —— 这不是“尺寸变了”,
    // 是无尺寸可算。跳过:切回本视图时 ResizeObserver 会带真实尺寸再触发一次。
    if (viewHeight === 0) return;

    // 计算看板可用高度
    let boardMaxHeight = viewHeight - 24; // 减去 tabboard 的 padding (12px * 2)
    const actionsHeader = groupView.querySelector('.board-actions-header');
    if (actionsHeader) {
      boardMaxHeight -= actionsHeader.offsetHeight + 8; // 减去按钮高度和 margin-bottom
    }
    const boardHeight = Math.max(200, boardMaxHeight); // 最小高度 200px

    groupView.querySelectorAll('.kanban-board').forEach(board => {
      board.style.height = `${boardHeight}px`;
    });
  }

  /**
   * rAF 去抖:一次窗口拖拽/缩放会连发几十个 resize,每个都同步读 offsetHeight
   * (强制 reflow)再写 style 会造成 layout thrashing。合并到下一帧只算一次。
   */
  _scheduleBoardHeightSync() {
    if (this._heightSyncRaf) return;
    this._heightSyncRaf = requestAnimationFrame(() => {
      this._heightSyncRaf = null;
      this._syncBoardHeights();
    });
  }

  /**
   * 绑定看板高度的自动重算。两个信号源缺一不可:
   *  - window resize:窗口拖拽 + 浏览器缩放(zoom 改变 CSS px 视口,必发 resize)
   *  - ResizeObserver:覆盖 resize 事件收不到的“窗口没变、容器自己变了”
   *     —— 工具栏按钮换行导致 header 变高、display:none ⇄ block 切回本视图、
   *     字体加载完成等
   *
   * 监听器只挂一次(__heightSyncBound):render() 会被反复调用,而 GroupModule
   * 实例在 tabboard.js 里是缓存的(切走再切回只 render 不重建),重复挂会单向
   * 累积成监听器泄漏。但**观察目标**每轮 render 都会重建(工具栏 header),
   * 所以每轮都重新指定一次观察目标。
   */
  _bindBoardHeightAutoSync() {
    if (!this._heightSyncBound) {
      this._heightSyncBound = true;
      this._onWindowResize = () => this._scheduleBoardHeightSync();
      window.addEventListener('resize', this._onWindowResize);
      if (typeof ResizeObserver === 'function') {
        this._heightObserver = new ResizeObserver(() => this._scheduleBoardHeightSync());
      }
    }

    if (this._heightObserver) {
      // 旧 header 已随上一轮 render 脱离文档,重挂观察目标
      this._heightObserver.disconnect();
      const groupView = document.getElementById('groupView');
      if (groupView) this._heightObserver.observe(groupView);
      const actionsHeader = document.querySelector('.board-actions-header');
      if (actionsHeader) this._heightObserver.observe(actionsHeader);
    }
  }

  /**
   * 解绑看板高度自动重算(resize 监听 / ResizeObserver / 未执行的 rAF)
   */
  _unbindBoardHeightAutoSync() {
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
      this._onWindowResize = null;
    }
    if (this._heightObserver) {
      this._heightObserver.disconnect();
      this._heightObserver = null;
    }
    if (this._heightSyncRaf) {
      cancelAnimationFrame(this._heightSyncRaf);
      this._heightSyncRaf = null;
    }
    this._heightSyncBound = false;
  }

  /**
   * 设置删除按钮事件 - 使用事件委托
   */
  _setupDeleteButtons() {
    const container = document.getElementById('tabboard');
    container.removeEventListener('click', this._handleDeleteButtonClick);
    container.addEventListener('click', this._handleDeleteButtonClick.bind(this), true);

    container.removeEventListener('contextmenu', this._handleItemContextMenu);
    container.addEventListener('contextmenu', this._handleItemContextMenu.bind(this), true);
  }

  /**
   * 处理删除按钮点击
   */
  async _handleDeleteButtonClick(e) {
    const deleteBtn = e.target.closest('.kanban-item-delete');
    if (!deleteBtn) return;

    e.stopPropagation();
    e.preventDefault();
    e.stopImmediatePropagation();

    const tabId = deleteBtn.dataset.id;
    const itemEl = deleteBtn.closest('.kanban-item');
    const boardEl = itemEl?.closest('.kanban-board');
    const groupId = boardEl?.getAttribute('data-id');

    if (tabId && groupId) {
      await this.dataManager.sendMessage('deleteTab', { tabId, groupId });
    }
  }

  /**
   * 处理项目右键 - 弹出编辑对话框(供 goto 圆环显示用)
   */
  _handleItemContextMenu(e) {
    const itemEl = e.target.closest('.kanban-item');
    if (!itemEl) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const tabId = itemEl.getAttribute('data-eid');
    const boardEl = itemEl.closest('.kanban-board');
    const groupId = boardEl?.getAttribute('data-id');
    if (!tabId || !groupId) return;

    const tab = this._findTab(tabId);
    if (!tab) return;

    this._showEditTabDialog(tab, groupId);
  }

  /**
   * 处理项目点击
   */
  _handleItemClick(el) {
    const itemId = el.getAttribute('data-eid');
    const tab = this._findTab(itemId);
    if (tab) {
      this.dataManager.sendMessage('openTab', { url: tab.url });
    }
  }

  /**
   * 处理拖拽结束 - 保存更改到存储
   */
  async _handleDropEl(el, target, source, sibling) {
    const itemId = el.getAttribute('data-eid');
    const targetBoardId = target.parentElement.getAttribute('data-id');
    const sourceBoardId = source.parentElement.getAttribute('data-id');

    // 获取 sibling 的 ID 来确定插入位置
    const siblingId = sibling?.getAttribute('data-eid') || null;

    // 通过 background 更新存储，包含位置信息
    await this.dataManager.sendMessage('moveTab', {
      tabId: itemId,
      fromGroup: sourceBoardId,
      toGroup: targetBoardId,
      afterTabId: siblingId  // 用于确定插入顺序
    });
  }

  /**
   * 处理拖拽结束
   */
  _handleDragEndEl(el) {
    // 可以在这里添加额外的处理逻辑
  }

  /**
   * 处理看板拖拽 - 保存看板顺序
   */
  async _handleDropBoard(el, target, source, sibling) {
    // 获取所有看板的当前顺序
    const container = document.querySelector('.kanban-container');
    const boardElements = container.querySelectorAll('.kanban-board');

    // 按照当前 DOM 顺序收集看板 ID
    const boardOrder = Array.from(boardElements).map(board => board.getAttribute('data-id'));

    // 更新看板顺序到存储
    await this.dataManager.sendMessage('updateBoardOrder', { boardOrder });
  }

  /**
   * 处理看板按钮点击
   */
  _handleBoardButtonClick(el, boardId) {
    // 可以在这里添加处理逻辑
  }

  /**
   * 处理打开所有按钮
   */
  async _handleOpenAll(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    await this.dataManager.sendMessage('openGroup', { groupId });
  }

  /**
   * 处理清空分组按钮
   */
  async _handleClearGroup(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    const groupTabs = this.tabs[groupId] || [];

    if (groupTabs.length === 0) return;

    const groupName = this.groups.find(g => g.id === groupId)?.name;
    const confirmed = await modal.confirm(`确定要清空 "${groupName}" 分组吗？`, {
      title: '清空分组',
      type: 'warning'
    });
    if (!confirmed) {
      return;
    }

    for (const tab of groupTabs) {
      await this.dataManager.sendMessage('deleteTab', {
        tabId: tab.id,
        groupId
      });
    }
  }

  /**
   * 处理删除分组按钮
   */
  async _handleDeleteGroup(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    const groupTabs = this.tabs[groupId] || [];
    const groupName = this.groups.find(g => g.id === groupId)?.name;

    const message = groupTabs.length > 0
      ? `确定要删除 "${groupName}" 分组吗？该分组包含 ${groupTabs.length} 个标签，将被一起删除。`
      : `确定要删除 "${groupName}" 分组吗？`;

    const confirmed = await modal.confirm(message, {
      title: '删除分组',
      type: 'danger'
    });
    if (!confirmed) {
      return;
    }

    await this.dataManager.sendMessage('deleteGroup', { groupId });
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 处理 goto 按钮 - 切换 group 的 goto 标志
   * 同时只能有一个 group.goto === true
   * - 若当前 group 已经是 goto 源 → 取消(再次点击移除 goto 状态)
   * - 否则 → 设为 goto 源(其他 group 的 goto 自动清除)
   */
  async _handlePushToGotoRing(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    const targetGroup = this.groups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const willBeGoto = targetGroup.goto !== true;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = willBeGoto ? '设置中…' : '移除中…';

    try {
      const result = await this.dataManager.sendMessage('setGroupAsGoto', { groupId });
      if (result && result.success) {
        // 更新本地内存中的 group.goto 状态(允许多个 group 同时 goto)
        targetGroup.goto = result.isGoto;
        // 重新渲染以更新所有 board 按钮的激活态
        this.render();
      } else {
        alert(`操作失败: ${result?.error || '未知错误'}`);
      }
    } catch (err) {
      alert(`操作失败: ${err.message || err}`);
    } finally {
      btn.disabled = false;
      if (document.body.contains(btn)) {
        btn.textContent = originalText;
      }
    }
  }

  /**
   * 设置分组视图操作按钮
   */
  _setupGroupActionButtons() {
    const addGroupBtn = document.querySelector('.add-group-btn');
    const filterBtn = document.querySelector('.filter-groups-btn');
    const refreshSortBtn = document.querySelector('.refresh-sort-btn');
    const openAllBtn = document.querySelector('.open-all-groups-btn');
    const importBookmarksBtn = document.querySelector('.import-bookmarks-btn');
    const tomlExportBtn = document.querySelector('.toml-export-btn');
    const tomlAiBtn = document.querySelector('.toml-ai-btn');

    if (addGroupBtn) {
      addGroupBtn.addEventListener('click', () => this._showAddGroupDialog());
    }

    if (filterBtn) {
      filterBtn.addEventListener('click', () => this._showGroupFilterDialog());
    }

    if (refreshSortBtn) {
      refreshSortBtn.addEventListener('click', () => this._refreshAndSort());
    }

    if (openAllBtn) {
      openAllBtn.addEventListener('click', async () => {
        const confirmed = await modal.confirm(`确定要打开所有 ${this.groups.length} 个分组吗？`, {
          title: '打开所有分组',
          type: 'warning'
        });
        if (!confirmed) return;
        for (const group of this.groups) {
          await this.dataManager.sendMessage('openGroup', { groupId: group.id });
        }
      });
    }

    if (importBookmarksBtn) {
      importBookmarksBtn.addEventListener('click', () => this._showBookmarkImportDialog());
    }

    if (tomlExportBtn) {
      tomlExportBtn.addEventListener('click', () => this._exportToml());
    }

    if (tomlAiBtn) {
      tomlAiBtn.addEventListener('click', () => this._showTomlAiDialog());
    }

    // 【ns】命名空间下拉框 change 事件(once-bound,避免 render() 多次调用累积监听器)
    this._setupNamespaceSwitcher();
  }

  /**
   * 【ns】绑定 ns 切换器事件。
   * - 徽章点击展开/收起下拉面板(识别元素本身承担切换入口)
   * - 「＋ 新建命名空间」条目展开创建输入行
   * - change / Enter / input 防抖 / 应用按钮 四重保险,避免任一路径丢失保存
   * - 走 dataManager.sendMessage('setActiveNamespace', { namespace }) 切 ns
   * - 成功后 loadData + updateData + render()(render 重建 DOM,面板自然回到收起态)
   * - 失败时保留输入,便于修正重试
   * 注:跨源切 ns(popup / content script)的同步,由 tabboard.js 的
   *     storage.onChanged 监听器触发 updateData() + render(),此切换器随之刷新。
   */
  _setupNamespaceSwitcher() {
    const nsInput = document.querySelector('#board-ns-input');
    if (!nsInput || nsInput.__nsBound) return;
    nsInput.__nsBound = true;

    const panel = document.querySelector('#board-ns-panel');
    const createRow = document.querySelector('#board-ns-create');

    // 点击 input 时全选已有文本,键入直接替换(避免「default」+「study」=「defaultstudy」)
    nsInput.addEventListener('focus', () => {
      setTimeout(() => nsInput.select(), 0);
    });

    /** 展开面板;create=true 时同时展开创建输入行并聚焦 */
    const openPanel = (create = false) => {
      if (panel) panel.hidden = false;
      const badge = document.querySelector('#board-ns-badge');
      if (badge) badge.classList.add('open');
      if (create) {
        if (createRow) createRow.hidden = false;
        nsInput.focus();
        nsInput.select();
      }
    };

    /** 收起面板(含创建输入行) */
    const closePanel = () => {
      if (panel) panel.hidden = true;
      if (createRow) createRow.hidden = true;
      const badge = document.querySelector('#board-ns-badge');
      if (badge) badge.classList.remove('open');
    };

    async function commitSwitch(newNs) {
      if (!newNs || newNs === this.activeNamespace) {
        nsInput.value = '';
        closePanel();
        return;
      }

      let result;
      try {
        result = await this.dataManager.sendMessage('setActiveNamespace', { namespace: newNs });
      } catch (err) {
        alert(`切换命名空间失败: ${err?.message || err}`);
        return;
      }

      if (!result || result.success === false || result.error) {
        alert(`切换命名空间失败: ${result?.error || '未知错误'}`);
        return;
      }

      // 成功:更新数据并重渲染(updateData 同步 activeNamespace → 徽章/chips 重绘)
      try {
        const data = await this.dataManager.loadData();
        this.updateData(data);
        this.render();
      } catch (err) {
        console.error('[GroupView] loadData after ns switch failed:', err);
      }
    }

    // 0) 徽章(仅多 ns):点击展开/收起下拉面板
    const badge = document.querySelector('#board-ns-badge');
    if (badge && !badge.__nsBound) {
      badge.__nsBound = true;
      badge.addEventListener('mousedown', (e) => {
        // mousedown 优先于 click/blur,避免 input blur 触发意外 change
        e.preventDefault();
        if (panel && panel.hidden) openPanel(); else closePanel();
      });
    }

    // 1) 「＋ 新建命名空间」— 展开面板 + 创建输入行;再点一次收起
    const newSingleBtn = document.querySelector('#board-ns-new-single');
    if (newSingleBtn && !newSingleBtn.__nsBound) {
      newSingleBtn.__nsBound = true;
      newSingleBtn.addEventListener('mousedown', (e) => {
        // mousedown 优先于 click/blur,避免 input blur 触发意外 change
        e.preventDefault();
        if (panel && !panel.hidden && createRow && !createRow.hidden) {
          closePanel();
        } else {
          openPanel(true);
        }
      });
    }

    // 2) change:Enter / blur(可能因页面卸载丢失,故加多重入口)
    nsInput.addEventListener('change', (e) => {
      commitSwitch.call(this, e.target.value.trim());
    });

    // 3) Enter 即时提交;Escape 收起面板
    nsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSwitch.call(this, e.target.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    });

    // 4) input 防抖:用户一边输一边提交,避免「输完关页面/关 popup」丢保存
    let debounceTimer = null;
    nsInput.addEventListener('input', (e) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const newNs = e.target.value.trim();
      if (!newNs || newNs === this.activeNamespace) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        commitSwitch.call(this, newNs);
      }, 250);
    });

    // 5) 「应用」按钮 — 显式保存入口
    const applyBtn = document.querySelector('#board-ns-apply');
    if (applyBtn && !applyBtn.__nsBound) {
      applyBtn.__nsBound = true;
      applyBtn.addEventListener('mousedown', (e) => {
        // mousedown 在 input blur 之前触发,避免 button click 因 input blur 丢失
        e.preventDefault();
        commitSwitch.call(this, nsInput.value.trim());
      });
    }

    // 6) chip 列表(仅多 ns):点哪个直接切哪个(active chip 高亮)
    document.querySelectorAll('#board-ns-chips .ns-chip').forEach(chip => {
      if (chip.__nsBound) return;
      chip.__nsBound = true;
      chip.addEventListener('mousedown', (e) => {
        // mousedown 在 input blur 之前,避免 click 丢失
        e.preventDefault();
        commitSwitch.call(this, chip.dataset.ns);
      });
    });

    // 7) 面板外点击收起。用「捕获阶段(capture)」监听:看板/jKanban/弹层等组件
    //    可能在 mousedown 冒泡阶段调用 stopPropagation,冒泡监听会收不到;
    //    捕获阶段最先触发,任何冒泡拦截都挡不住「点外面关闭」。
    //    (重渲染时旧监听已随旧 DOM 失效,但 document 级监听会累积,
    //    用 remove-previous 模式;switcher-wrap 内点击由各自 mousedown 处理)
    if (document.__boardNsOutsideClose) {
      document.removeEventListener('mousedown', document.__boardNsOutsideClose, true);
    }
    const wrap = document.querySelector('.ns-switcher-wrap');
    const onOutside = (e) => {
      if (wrap && !wrap.contains(e.target)) closePanel();
    };
    document.__boardNsOutsideClose = onOutside;
    document.addEventListener('mousedown', onOutside, true);
  }

  /**
   * 下载文本文件(TOML 导出用)
   */
  _downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 快捷导出:把当前命名空间下的分组收藏序列化为 TOML 文件下载
   */
  _exportToml() {
    if (!this.groups || this.groups.length === 0) {
      alert('当前没有可导出的分组');
      return;
    }
    const toml = serializeGroupsToToml(this.groups, this.tabs);
    const filename = `tabboard-groups-${new Date().toISOString().slice(0, 10)}.toml`;
    this._downloadTextFile(filename, toml, 'application/toml;charset=utf-8');
  }

  /**
   * 通过 chrome.tabs 官方 API 获取当前浏览器打开的标签页(L2 参考数据)。
   * tabboard 是扩展页,且 manifest 已声明 "tabs" 权限,可直接读取 title/url。
   * 仅保留 http/https 页面(过滤 chrome:// / 扩展页 / about: 等噪声),按 URL 去重。
   * @returns {Promise<Array<{title:string,url:string}>>}
   */
  async _queryBrowserTabs() {
    const allTabs = await chrome.tabs.query({});
    const seen = new Set();
    const result = [];
    for (const tab of allTabs) {
      if (!tab || typeof tab.url !== 'string') continue;
      if (!/^https?:\/\//i.test(tab.url)) continue;
      if (seen.has(tab.url)) continue;
      seen.add(tab.url);
      const title = (typeof tab.title === 'string' && tab.title.trim()) ? tab.title.trim() : tab.url;
      result.push({ title, url: tab.url });
    }
    return result;
  }

  /**
   * 复制文本到剪贴板:优先 Clipboard API,失败时降级 execCommand(扩展页兼容)。
   */
  async _copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /**
   * 读取剪贴板文本。优先异步 Clipboard API;不可用或被拒时返回 null
   * (由调用方提示用户改用 Ctrl+V;execCommand('paste') 在扩展页通常被禁)。
   * @returns {Promise<string|null>}
   */
  async _readClipboardText() {
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      const text = await navigator.clipboard.readText();
      return typeof text === 'string' ? text : null;
    }
    return null;
  }

  /**
   * 从 AI 回复中提取 TOML 本体。
   * 1) 含 markdown 代码围栏 → 取其中「带 toml 标记」的代码块;没有则取第一个代码块
   * 2) 无围栏但内容本身像 TOML(出现 [[groups]] 或 version =)→ 直接 trim
   * 3) 都不是 → null
   * @param {string} content
   * @returns {string|null}
   */
  _extractTomlBlock(content) {
    if (typeof content !== 'string') return null;
    const text = content.replace(/^\uFEFF/, '');

    // 匹配 ```lang ... ``` 形式的围栏块;lang 可省略
    const fenceRe = /```[ \t]*([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while ((match = fenceRe.exec(text)) !== null) {
      blocks.push({ lang: (match[1] || '').toLowerCase(), body: match[2] });
    }

    if (blocks.length > 0) {
      const tomlBlock = blocks.find(b => b.lang === 'toml') || blocks[0];
      const body = tomlBlock.body.trim();
      if (body && (body.includes('[[groups]]') || /version\s*=/.test(body))) return body;
      return body || null;
    }

    // 无围栏:整段本身就是 TOML 才接受,避免把寒暄文本喂给解析器
    const trimmed = text.trim();
    if (trimmed.includes('[[groups]]') || /^\s*version\s*=/m.test(trimmed)) {
      return trimmed;
    }
    return null;
  }

  /**
   * 显示 AI 导入 / TOML 面板:
   * ① 多段提示词生成 —— L1(TOML 领域标准)常驻;L2(当前浏览器标签页,
   *    chrome.tabs API)仅在勾选时追加;勾选「goto 圆环场景」则追加圆环约束
   *    (每组 ≤ 6 标签、goto = true);一键复制,拿到任意外部 AI 平台生成 TOML。
   * ② TOML 输入面板 —— 粘贴或选择 .toml 文件,合并导入为新分组(不覆盖已有数据);
   *    goto 模式下导入端会强制 goto=true 并把每组截断到 6 个兜底。
   */
  _showTomlAiDialog() {
    const existing = document.getElementById('toml-ai-dialog');
    if (existing) existing.remove();

    // 面板状态:L2 默认不追加;browserTabs 首次勾选时懒加载
    let includeL2 = false;
    let browserTabs = null;
    // goto 圆环场景:勾选后提示词附加圆环约束,导入时强制 goto=true 且每组 ≤ 6
    let gotoRing = false;

    const overlay = document.createElement('div');
    overlay.id = 'toml-ai-dialog';
    overlay.className = 'toml-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'toml-dialog';
    dialog.innerHTML = `
      <div class="toml-dialog-header">
        <h3>TOML 导入 / AI 整理面板</h3>
        <button class="toml-close-btn" title="关闭">×</button>
      </div>
      <div class="toml-dialog-body">
        <section class="toml-panel-section">
          <h4>① 生成提示词(复制给任意 AI 平台)</h4>
          <label class="toml-check-row">
            <input type="checkbox" class="toml-opt-l2">
            <span>追加当前浏览器已打开的标签页作为参考(L2 · chrome.tabs 官方 API)</span>
          </label>
          <label class="toml-check-row">
            <input type="checkbox" class="toml-opt-goto">
            <span>goto 圆环场景(提示词要求每个分组 ≤ 6 个标签,超出不会显示在圆环)</span>
          </label>
          <div class="toml-l2-status toml-l2-status-off">未勾选:提示词仅包含 L1 领域格式标准</div>
          <textarea class="toml-prompt-text" rows="20" readonly spellcheck="false"></textarea>
          <div class="toml-btn-row">
            <button class="toml-btn toml-btn-primary toml-copy-prompt-btn">复制提示词</button>
            <button class="toml-btn toml-btn-ghost toml-refresh-l2-btn" disabled title="勾选 L2 后重新读取当前标签页">重新获取标签页</button>
          </div>
        </section>

        <section class="toml-panel-section">
          <h4>② 取回 AI 结果,一键导入为新分组</h4>
          <textarea class="toml-import-text" rows="10" spellcheck="false"
            placeholder="在外部 AI 平台拿到结果后,直接点「从剪贴板粘贴」(自动识别并剥离代码围栏),或点「选择 .toml 文件」……&#10;&#10;格式示例:&#10;version = &quot;1.0&quot;&#10;&#10;[[groups]]&#10;name = &quot;分组名&quot;&#10;color = &quot;#45b7d1&quot;&#10;&#10;[[groups.tabs]]&#10;title = &quot;标题&quot;&#10;url = &quot;https://example.com/&quot;"></textarea>
          <div class="toml-btn-row">
            <button class="toml-btn toml-btn-primary toml-paste-clipboard-btn" title="读取剪贴板中的 AI 回复,自动提取 TOML 代码块">从剪贴板粘贴</button>
            <button class="toml-btn toml-btn-ghost toml-pick-file-btn">选择 .toml 文件</button>
            <button class="toml-btn toml-btn-primary toml-import-confirm-btn">解析并导入为新分组</button>
          </div>
          <div class="toml-hint">工作流:复制提示词 → 发给 AI → 复制 AI 回复 → 点「从剪贴板粘贴」→ 导入。导入为「合并」语义:只新建分组,不覆盖已有收藏;分组默认进入当前命名空间「${escapeHtml(this.activeNamespace)}」。</div>
        </section>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const l2Checkbox = dialog.querySelector('.toml-opt-l2');
    const gotoCheckbox = dialog.querySelector('.toml-opt-goto');
    const l2Status = dialog.querySelector('.toml-l2-status');
    const promptText = dialog.querySelector('.toml-prompt-text');
    const copyBtn = dialog.querySelector('.toml-copy-prompt-btn');
    const refreshBtn = dialog.querySelector('.toml-refresh-l2-btn');
    const pickFileBtn = dialog.querySelector('.toml-pick-file-btn');
    const pasteClipboardBtn = dialog.querySelector('.toml-paste-clipboard-btn');
    const importConfirmBtn = dialog.querySelector('.toml-import-confirm-btn');
    const importText = dialog.querySelector('.toml-import-text');

    /** 按当前勾选状态重绘提示词 */
    const refreshPrompt = () => {
      promptText.value = buildAiPrompt({ tabs: includeL2 ? browserTabs : null, gotoRing });
    };

    /** 拉取 L2 标签页(force=true 时强制重新查询) */
    const loadL2Tabs = async (force = false) => {
      if (browserTabs && !force) return browserTabs;
      l2Status.className = 'toml-l2-status toml-l2-status-loading';
      l2Status.textContent = '正在通过 chrome.tabs API 读取当前标签页…';
      try {
        browserTabs = await this._queryBrowserTabs();
        if (browserTabs.length === 0) {
          l2Status.className = 'toml-l2-status toml-l2-status-warn';
          l2Status.textContent = '没有读到可用的 http/https 标签页,L2 段将为空';
        } else {
          l2Status.className = 'toml-l2-status toml-l2-status-on';
          l2Status.textContent = `已获取 ${browserTabs.length} 个当前标签页,已追加到 L2 段`;
        }
        refreshBtn.disabled = false;
        return browserTabs;
      } catch (err) {
        browserTabs = null;
        l2Status.className = 'toml-l2-status toml-l2-status-warn';
        l2Status.textContent = `读取标签页失败:${err?.message || err}`;
        refreshBtn.disabled = true;
        return null;
      }
    };

    // goto 圆环场景勾选 —— 仅影响提示词内容与导入时的强制规则
    gotoCheckbox.addEventListener('change', () => {
      gotoRing = gotoCheckbox.checked;
      refreshPrompt();
    });

    // 初始:仅 L1
    refreshPrompt();

    // L2 勾选 —— 勾选才查询并追加当前浏览器标签页;取消勾选立即回到 L1-only
    l2Checkbox.addEventListener('change', async () => {
      includeL2 = l2Checkbox.checked;
      if (includeL2) {
        await loadL2Tabs(false);
      } else {
        l2Status.className = 'toml-l2-status toml-l2-status-off';
        l2Status.textContent = '未勾选:提示词仅包含 L1 领域格式标准';
        refreshBtn.disabled = true;
      }
      refreshPrompt();
    });

    refreshBtn.addEventListener('click', async () => {
      if (!includeL2) return;
      refreshBtn.disabled = true;
      await loadL2Tabs(true);
      refreshBtn.disabled = false;
      refreshPrompt();
    });

    // 复制提示词
    copyBtn.addEventListener('click', async () => {
      const original = copyBtn.textContent;
      const ok = await this._copyText(promptText.value);
      copyBtn.textContent = ok ? '已复制 ✓' : '复制失败,请手动选择复制';
      copyBtn.classList.toggle('toml-copy-ok', ok);
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.classList.remove('toml-copy-ok');
      }, 1600);
    });

    // 从剪贴板一键取回 AI 回复:自动剥离 markdown 围栏/寒暄文本,只留 TOML 本体
    pasteClipboardBtn.addEventListener('click', async () => {
      const original = pasteClipboardBtn.textContent;
      pasteClipboardBtn.disabled = true;
      pasteClipboardBtn.textContent = '读取中…';
      try {
        const clip = await this._readClipboardText();
        if (!clip) {
          alert('剪贴板为空,或浏览器拒绝了读取权限。请用 Ctrl+V 手动粘贴到输入框。');
          return;
        }
        const toml = this._extractTomlBlock(clip);
        if (!toml) {
          alert('剪贴板内容里没有识别到 TOML(需包含 version 或 [[groups]])。请确认已复制 AI 的完整回复。');
          return;
        }
        importText.value = toml;
        importText.focus();
        pasteClipboardBtn.textContent = '已粘贴 ✓';
        setTimeout(() => {
          pasteClipboardBtn.textContent = original;
          pasteClipboardBtn.disabled = false;
        }, 1400);
      } catch (err) {
        alert(`读取剪贴板失败:${err.message || err}\n可改用 Ctrl+V 手动粘贴。`);
        pasteClipboardBtn.textContent = original;
        pasteClipboardBtn.disabled = false;
      }
    });

    // 选择 .toml 文件 → 填入输入面板(再由用户确认导入)
    pickFileBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.toml,.txt,text/plain,application/toml';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          importText.value = await file.text();
          importText.focus();
        } catch (err) {
          alert(`读取文件失败:${err.message || err}`);
        }
      });
      input.click();
    });

    // 解析并合并导入
    importConfirmBtn.addEventListener('click', async () => {
      const rawInput = importText.value.trim();
      if (!rawInput) {
        alert('请先粘贴 AI 回复 / TOML 内容,或选择 .toml 文件');
        return;
      }

      // 兼容手动粘贴整段 AI 回复:自动剥离 ```toml 代码围栏
      const raw = this._extractTomlBlock(rawInput) || rawInput;

      let parsed;
      try {
        parsed = parseGroupsToml(raw);
      } catch (err) {
        alert(`TOML 解析失败:\n${err.message || err}`);
        return;
      }

      // goto 圆环场景兜底:强制 goto=true,每组只保留前 6 个(圆环硬限制,
      // 与 background/group-model.js getGotoMenuData 的 slice(0,6) 一致)
      let gotoDropped = 0;
      if (gotoRing) {
        parsed.groups.forEach((g) => {
          g.goto = true;
          if (g.tabs.length > 6) {
            gotoDropped += g.tabs.length - 6;
            g.tabs = g.tabs.slice(0, 6);
          }
        });
      }

      const groupCount = parsed.groups.length;
      const tabCount = parsed.groups.reduce((n, g) => n + g.tabs.length, 0);
      if (tabCount === 0) {
        alert('TOML 中没有任何有效标签(每个分组至少需要一个带 url 的 [[groups.tabs]])');
        return;
      }

      const gotoNote = gotoRing
        ? `\n[goto 圆环模式] 已将 ${groupCount} 个分组全部设为圆环展示`
          + (gotoDropped > 0
            ? `;有 ${gotoDropped} 个标签因分组超过 6 个上限被截断(超出圆环显示范围)`
            : ';每组均在 6 个以内')
        : '';
      const confirmed = await modal.confirm(
        `将新建 ${groupCount} 个分组、共 ${tabCount} 个标签。\n采用合并导入,不会覆盖或删除已有分组。${gotoNote}\n确认继续?`,
        { title: 'TOML 导入', type: 'warning' }
      );
      if (!confirmed) return;

      importConfirmBtn.disabled = true;
      importConfirmBtn.textContent = '导入中…';
      try {
        const res = await this.dataManager.sendMessage('importTomlGroups', { groups: parsed.groups });
        if (!res || res.success === false) {
          alert(`导入失败:${res?.error || '未知错误'}`);
          return;
        }
        await this.dataManager.loadData();
        this.render();
        closeDialog();
        const skipNote = res.skipped > 0 ? `\n跳过无效/重复标签 ${res.skipped} 个` : '';
        alert(`导入完成:新建 ${res.imported} 个分组、${res.tabs} 个标签${skipNote}`);
      } catch (err) {
        alert(`导入失败:${err.message || err}`);
      } finally {
        importConfirmBtn.disabled = false;
        importConfirmBtn.textContent = '解析并导入为新分组';
      }
    });

    // 关闭交互(× / 取消按钮 / 点遮罩 / Esc)
    const closeDialog = () => overlay.remove();
    dialog.querySelector('.toml-close-btn').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        closeDialog();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  }

  /**
   * 显示书签导入对话框
   * 从浏览器书签树中选择书签，导入到指定分组
   */
  _showBookmarkImportDialog() {
    if (this.groups.length === 0) {
      alert('请先创建一个分组再导入书签');
      return;
    }

    // 移除已存在的对话框
    const existing = document.getElementById('bookmark-import-dialog');
    if (existing) existing.remove();

    // 选中书签的临时存储：{ [bookmarkId]: { title, url } }
    const selectedBookmarks = new Map();

    const overlay = document.createElement('div');
    overlay.id = 'bookmark-import-dialog';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #f8f9fa; border-radius: 8px; padding: 20px;
      width: 720px; max-width: 90vw; height: 560px; max-height: 85vh;
      display: flex; flex-direction: column; gap: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    `;

    // 头部
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `
      <h3 style="margin:0; font-size:18px;">从浏览器书签导入</h3>
      <button class="bm-close-btn" style="background:none; border:none; font-size:20px; cursor:pointer;">×</button>
    `;
    dialog.appendChild(header);

    // 工具栏：全选/全不选 + 目标分组
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; gap:10px; flex-wrap: wrap;';
    toolbar.innerHTML = `
      <button class="bm-select-all-btn" style="padding:6px 12px; cursor:pointer;">全选书签</button>
      <button class="bm-deselect-all-btn" style="padding:6px 12px; cursor:pointer;">全不选</button>
      <span style="margin-left:auto; display:flex; align-items:center; gap:6px;">
        <span style="font-weight:500;">目标分组：</span>
        <select class="bm-target-group" style="padding:6px 10px; min-width:160px;">
          ${this.groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </span>
    `;
    dialog.appendChild(toolbar);

    // 书签树容器
    const treeContainer = document.createElement('div');
    treeContainer.className = 'bm-tree';
    treeContainer.style.cssText = `
      flex: 1; overflow: auto; background: white; border-radius: 4px;
      padding: 10px; border: 1px solid #e0e0e0; min-height: 0;
    `;
    treeContainer.innerHTML = '<div style="text-align:center; color:#888; padding:20px;">加载书签中…</div>';
    dialog.appendChild(treeContainer);

    // 底部状态栏 + 导入按钮
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid #ddd;';
    footer.innerHTML = `
      <span class="bm-selected-count" style="color:#666; font-size:13px;">已选 0 个</span>
      <div>
        <button class="bm-cancel-btn" style="margin-right:10px; padding:8px 16px; cursor:pointer; background:#6c757d; color:white; border:none; border-radius:4px;">取消</button>
        <button class="bm-import-btn" style="padding:8px 16px; cursor:pointer; background:#007bff; color:white; border:none; border-radius:4px;">导入</button>
      </div>
    `;
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const closeDialog = () => overlay.remove();
    const updateCount = () => {
      footer.querySelector('.bm-selected-count').textContent = `已选 ${selectedBookmarks.size} 个`;
    };

    // 关闭按钮
    header.querySelector('.bm-close-btn').addEventListener('click', closeDialog);
    footer.querySelector('.bm-cancel-btn').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        closeDialog();
        document.removeEventListener('keydown', onEsc);
      }
    });

    // 全选/全不选
    footer.previousElementSibling; // (treeContainer not used here)
    toolbar.querySelector('.bm-select-all-btn').addEventListener('click', () => {
      treeContainer.querySelectorAll('.bm-bookmark-item').forEach(el => {
        if (!el.classList.contains('selected')) {
          el.classList.add('selected');
          selectedBookmarks.set(el.dataset.id, {
            title: el.dataset.title,
            url: el.dataset.url
          });
        }
      });
      updateCount();
    });
    toolbar.querySelector('.bm-deselect-all-btn').addEventListener('click', () => {
      treeContainer.querySelectorAll('.bm-bookmark-item.selected').forEach(el => el.classList.remove('selected'));
      selectedBookmarks.clear();
      updateCount();
    });

    // 渲染书签节点（递归）
    const renderNode = (node, level = 0) => {
      const wrap = document.createElement('div');
      wrap.className = 'bm-node';

      if (node.url) {
        // 书签
        const item = document.createElement('div');
        item.className = 'bm-bookmark-item';
        item.dataset.id = node.id;
        item.dataset.title = node.title || node.url;
        item.dataset.url = node.url;
        item.style.cssText = `
          display:flex; align-items:center; gap:8px;
          padding:6px 8px 6px ${8 + level * 16}px;
          margin: 2px 0; border-radius: 4px; cursor: pointer;
          transition: background 0.15s;
        `;
        item.innerHTML = `
          <span style="font-size:14px;">🔗</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(node.title || node.url)}</span>
          <span style="color:#888; font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(node.url)}</span>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.classList.toggle('selected')) {
            selectedBookmarks.set(node.id, { title: node.title || node.url, url: node.url });
          } else {
            selectedBookmarks.delete(node.id);
          }
          updateCount();
        });
        item.addEventListener('mouseenter', () => { item.style.background = '#f0f4ff'; });
        item.addEventListener('mouseleave', () => {
          item.style.background = item.classList.contains('selected') ? '#e3f2fd' : '';
        });
        wrap.appendChild(item);
      } else if (node.children) {
        // 文件夹
        const folder = document.createElement('div');
        folder.className = 'bm-folder';
        folder.style.cssText = 'margin: 2px 0;';

        const folderHeader = document.createElement('div');
        folderHeader.className = 'bm-folder-header';
        folderHeader.style.cssText = `
          display:flex; align-items:center; gap:6px;
          padding: 6px 8px 6px ${8 + level * 16}px;
          cursor:pointer; border-radius:4px; user-select:none;
        `;
        folderHeader.innerHTML = `
          <span class="bm-folder-icon" style="font-size:12px; transition: transform 0.15s;">▶</span>
          <span style="font-size:14px;">📁</span>
          <span style="flex:1; font-weight:500;">${escapeHtml(node.title || '未命名文件夹')}</span>
          <span class="bm-folder-count" style="color:#888; font-size:12px;">${node.children.length} 项</span>
        `;
        folderHeader.addEventListener('click', () => folder.classList.toggle('expanded'));
        folderHeader.addEventListener('mouseenter', () => { folderHeader.style.background = '#f0f0f0'; });
        folderHeader.addEventListener('mouseleave', () => { folderHeader.style.background = ''; });
        folder.appendChild(folderHeader);

        const children = document.createElement('div');
        children.className = 'bm-folder-children';
        children.style.cssText = 'display:none;';
        node.children.forEach(child => {
          children.appendChild(renderNode(child, level + 1));
        });
        folder.appendChild(children);

        // 监听 expanded 切换
        const observer = new MutationObserver(() => {
          const expanded = folder.classList.contains('expanded');
          children.style.display = expanded ? 'block' : 'none';
          folderHeader.querySelector('.bm-folder-icon').style.transform = expanded ? 'rotate(90deg)' : '';
        });
        observer.observe(folder, { attributes: true, attributeFilter: ['class'] });

        wrap.appendChild(folder);
      }

      return wrap;
    };

    // 加载书签树
    chrome.bookmarks.getTree((bookmarkTree) => {
      treeContainer.innerHTML = '';
      const rootChildren = [];
      bookmarkTree.forEach(root => {
        if (root.children) rootChildren.push(...root.children);
      });

      if (rootChildren.length === 0) {
        treeContainer.innerHTML = '<div style="text-align:center; color:#888; padding:20px;">暂无书签</div>';
        return;
      }

      rootChildren.forEach(child => treeContainer.appendChild(renderNode(child)));
    });

    // 导入按钮
    footer.querySelector('.bm-import-btn').addEventListener('click', async () => {
      if (selectedBookmarks.size === 0) {
        alert('请至少选择一个书签');
        return;
      }
      const groupId = toolbar.querySelector('.bm-target-group').value;
      if (!groupId) {
        alert('请选择目标分组');
        return;
      }

      const importBtn = footer.querySelector('.bm-import-btn');
      importBtn.disabled = true;
      importBtn.textContent = '导入中…';

      let successCount = 0;
      let failCount = 0;
      for (const [, bm] of selectedBookmarks) {
        try {
          await this.dataManager.sendMessage('addTab', {
            tab: {
              title: bm.title,
              url: bm.url,
              favicon: `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32`,
              timestamp: new Date().toISOString()
            },
            groupId
          });
          successCount++;
        } catch (e) {
          failCount++;
        }
      }

      await this.dataManager.loadData();
      this.render();
      closeDialog();

      const groupName = this.groups.find(g => g.id === groupId)?.name || '目标分组';
      alert(`导入完成：成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}\n目标分组：${groupName}`);
    });
  }

  /**
   * 显示分组筛选对话框
   */
  _showGroupFilterDialog() {
    // 移除已存在的对话框
    const existingDialog = document.getElementById('group-filter-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    // 创建对话框遮罩
    const overlay = document.createElement('div');
    overlay.id = 'group-filter-dialog';
    overlay.className = 'group-filter-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    // 创建对话框内容
    const dialog = document.createElement('div');
    dialog.className = 'group-filter-dialog';
    dialog.style.cssText = `
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      min-width: 400px;
      max-width: 600px;
      max-height: 70vh;
      overflow: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    `;

    // 构建分组列表 HTML
    const groupListHtml = this.groups.map(group => {
      const isVisible = this.visibleGroups.has(group.id);
      const tabCount = this.tabs[group.id]?.length || 0;
      return `
        <div class="group-filter-item" data-group-id="${group.id}" style="
          display: flex;
          align-items: center;
          padding: 10px;
          margin: 5px 0;
          background: white;
          border-radius: 4px;
          transition: background 0.2s;
        ">
          <input type="checkbox" value="${group.id}" ${isVisible ? 'checked' : ''} style="margin-right: 10px;">
          <span class="group-color-indicator" style="
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            background: ${group.color};
          "></span>
          <span class="group-name" style="flex: 1; font-weight: 500;">${escapeHtml(group.name)}</span>
          <span class="group-tab-count" style="color: #888; font-size: 12px; margin-right: 10px;">${tabCount} 个标签</span>
          <button class="edit-group-name-btn" data-group-id="${group.id}" style="
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            padding: 4px 8px;
            opacity: 0.6;
            transition: opacity 0.2s;
          " title="编辑分组名称">Edit</button>
        </div>
      `;
    }).join('');

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">选择要显示的分组</h3>
        <button class="close-dialog-btn" style="background: none; border: none; font-size: 20px; cursor: pointer; padding: 4px;">×</button>
      </div>
      <div style="margin-bottom: 15px;">
        <button class="select-all-groups-btn" style="margin-right: 10px; padding: 8px 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; font-size: 14px;">全选</button>
        <button class="deselect-all-groups-btn" style="padding: 8px 16px; cursor: pointer; background: #6c757d; color: white; border: none; border-radius: 4px; font-size: 14px;">全不选</button>
      </div>
      <div class="group-filter-list">
        ${groupListHtml}
      </div>
      <div style="margin-top: 15px; text-align: right; padding-top: 15px; border-top: 1px solid #ddd;">
        <button class="cancel-filter-btn" style="margin-right: 10px; padding: 8px 16px; cursor: pointer; background: #6c757d; color: white; border: none; border-radius: 4px; font-size: 14px;">取消</button>
        <button class="apply-filter-btn" style="padding: 8px 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; font-size: 14px;">应用</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 添加事件监听
    const closeDialog = () => overlay.remove();

    dialog.querySelector('.close-dialog-btn').addEventListener('click', closeDialog);
    dialog.querySelector('.cancel-filter-btn').addEventListener('click', closeDialog);

    dialog.querySelector('.select-all-groups-btn').addEventListener('click', () => {
      dialog.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });

    dialog.querySelector('.deselect-all-groups-btn').addEventListener('click', () => {
      dialog.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });

    dialog.querySelector('.apply-filter-btn').addEventListener('click', async () => {
      const selectedGroups = Array.from(dialog.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);

      if (selectedGroups.length === 0) {
        alert('请至少选择一个分组');
        return;
      }

      // 走领域 API setGroupsVisibility(替代旧 updateSettings 的 read-modify-write)
      const result = await this.dataManager.sendMessage('setGroupsVisibility', {
        visibleGroupIds: selectedGroups
      });
      if (result?.success) {
        // 同步本地内存的 group.visible,避免依赖 storage 事件回流导致 UI 滞后
        const visibleSet = new Set(selectedGroups);
        for (const g of this.groups) g.visible = visibleSet.has(g.id);
        this._refreshVisibleGroups();
        this.render();
        closeDialog();
      }
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });

    // 添加 hover 效果
    dialog.querySelectorAll('.group-filter-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.background = '#f0f0f0';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'white';
      });
    });

    // 添加编辑按钮事件
    dialog.querySelectorAll('.edit-group-name-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.6';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startEditingGroupName(btn);
      });
    });
  }

  /**
   * 开始编辑分组名称
   */
  _startEditingGroupName(editBtn) {
    const groupItem = editBtn.closest('.group-filter-item');
    const groupId = editBtn.dataset.groupId;
    const nameSpan = groupItem.querySelector('.group-name');
    const currentName = nameSpan.textContent;

    // 创建编辑界面
    const editContainer = document.createElement('div');
    editContainer.className = 'group-name-edit-container';
    editContainer.style.cssText = 'display: flex; align-items: center; gap: 5px; flex: 1;';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'group-name-input';
    input.style.cssText = `
      flex: 1;
      padding: 4px 8px;
      border: 1px solid #007bff;
      border-radius: 4px;
      font-size: 14px;
      outline: none;
    `;

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'OK';
    saveBtn.className = 'save-group-name-btn';
    saveBtn.style.cssText = `
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    saveBtn.title = '保存';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'cancel-group-name-btn';
    cancelBtn.style.cssText = `
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    cancelBtn.title = '取消';

    editContainer.appendChild(input);
    editContainer.appendChild(saveBtn);
    editContainer.appendChild(cancelBtn);

    // 隐藏原始名称和编辑按钮
    nameSpan.style.display = 'none';
    editBtn.style.display = 'none';

    // 插入编辑界面
    nameSpan.parentNode.insertBefore(editContainer, editBtn);

    // 聚焦输入框
    input.focus();
    input.select();

    // 保存处理
    const saveEdit = async () => {
      const newName = input.value.trim();
      if (!newName) {
        alert('分组名称不能为空');
        return;
      }
      if (newName === currentName) {
        cancelEdit();
        return;
      }

      const result = await this.dataManager.sendMessage('updateGroupName', {
        groupId,
        newName
      });

      if (result.success) {
        await this.dataManager.loadData();
        nameSpan.textContent = newName;
        cancelEdit();
      } else {
        alert('更新失败，请重试');
      }
    };

    // 取消处理
    const cancelEdit = () => {
      editContainer.remove();
      nameSpan.style.display = '';
      editBtn.style.display = '';
    };

    // 事件绑定
    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveEdit();
      } else if (e.key === 'Escape') {
        cancelEdit();
      }
    });
  }

  // 默认颜色选项
  static DEFAULT_COLORS = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
    '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
  ];

  /**
   * 显示添加分组对话框
   */
  _showAddGroupDialog() {
    // 移除已存在的对话框
    const existingDialog = document.getElementById('add-group-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    // 创建对话框遮罩
    const overlay = document.createElement('div');
    overlay.id = 'add-group-dialog';
    overlay.className = 'add-group-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    // 创建对话框内容
    const dialog = document.createElement('div');
    dialog.className = 'add-group-dialog';
    dialog.style.cssText = `
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      min-width: 400px;
      max-width: 500px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    `;

    // 构建颜色选择器HTML
    const colorPickerHtml = GroupView.DEFAULT_COLORS.map(color => `
      <div class="color-option" style="
        width: 30px;
        height: 30px;
        border-radius: 50%;
        margin-right: 10px;
        background: ${color};
        cursor: pointer;
        border: 2px solid transparent;
        transition: border-color 0.2s;
      " data-color="${color}"></div>
    `).join('');

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">添加新分组</h3>
        <button class="close-dialog-btn" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">分组名称</label>
        <input type="text" id="new-group-name" style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        " placeholder="请输入分组名称">
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">分组颜色</label>
        <div id="color-picker" style="display: flex; flex-wrap: wrap;">
          ${colorPickerHtml}
        </div>
      </div>
      <div style="text-align: right; padding-top: 15px; border-top: 1px solid #ddd;">
        <button class="cancel-add-btn" style="
          margin-right: 10px;
          padding: 8px 16px;
          cursor: pointer;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
        ">取消</button>
        <button class="confirm-add-btn" style="
          padding: 8px 16px;
          cursor: pointer;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
        ">确定</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 选择默认颜色
    let selectedColor = GroupView.DEFAULT_COLORS[0];
    const colorOptions = dialog.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
      if (option.dataset.color === selectedColor) {
        option.style.borderColor = '#000';
      }
      option.addEventListener('click', () => {
        selectedColor = option.dataset.color;
        colorOptions.forEach(opt => opt.style.borderColor = 'transparent');
        option.style.borderColor = '#000';
      });
    });

    // 事件绑定
    const closeDialog = () => overlay.remove();

    dialog.querySelector('.close-dialog-btn').addEventListener('click', closeDialog);
    dialog.querySelector('.cancel-add-btn').addEventListener('click', closeDialog);

    dialog.querySelector('.confirm-add-btn').addEventListener('click', async () => {
      const groupName = document.getElementById('new-group-name').value.trim();
      if (!groupName) {
        alert('请输入分组名称');
        return;
      }

      await this.dataManager.sendMessage('addGroup', {
        name: groupName,
        color: selectedColor
      });

      await this.dataManager.loadData();
      this.render();
      closeDialog();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });

    // ESC键关闭对话框
    document.addEventListener('keydown', function handleEsc(e) {
      if (e.key === 'Escape') {
        closeDialog();
        document.removeEventListener('keydown', handleEsc);
      }
    });

    // 聚焦输入框
    document.getElementById('new-group-name').focus();
  }

  /**
   * 显示编辑 tab 对话框(右键触发)
   * 允许修改 title / url,标题过长时用于缩短以适配 goto 圆环显示
   */
  _showEditTabDialog(tab, groupId) {
    const existing = document.getElementById('edit-tab-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-tab-dialog';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 10001;
      display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #f8f9fa; border-radius: 8px; padding: 20px;
      min-width: 460px; max-width: 600px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    `;

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">编辑标签(用于 goto 圆环显示)</h3>
        <button class="et-close-btn" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">标题</label>
        <input type="text" class="et-title" style="
          width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;
          font-size: 14px; box-sizing: border-box;
        " value="${escapeHtml(tab.title)}" maxlength="60">
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">链接 URL</label>
        <input type="text" class="et-url" style="
          width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;
          font-size: 14px; box-sizing: border-box;
        " value="${escapeHtml(tab.url)}">
      </div>
      <div style="text-align: right; padding-top: 12px; border-top: 1px solid #ddd;">
        <button class="et-cancel-btn" style="
          margin-right: 10px; padding: 8px 16px; cursor: pointer;
          background: #6c757d; color: white; border: none; border-radius: 4px;
        ">取消</button>
        <button class="et-save-btn" style="
          padding: 8px 16px; cursor: pointer; background: #007bff; color: white;
          border: none; border-radius: 4px;
        ">保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const titleInput = dialog.querySelector('.et-title');
    const urlInput = dialog.querySelector('.et-url');
    const closeDialog = () => overlay.remove();

    // 关闭
    dialog.querySelector('.et-close-btn').addEventListener('click', closeDialog);
    dialog.querySelector('.et-cancel-btn').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeDialog(); document.removeEventListener('keydown', onEsc); }
    });

    // 自动选中 title
    setTimeout(() => { titleInput.focus(); titleInput.select(); }, 0);

    // 保存
    const saveHandler = async () => {
      const newTitle = titleInput.value.trim();
      const newUrl = urlInput.value.trim();
      if (!newTitle) { alert('标题不能为空'); return; }
      if (!newUrl) { alert('URL 不能为空'); return; }
      try { new URL(newUrl); } catch (e) { alert('URL 格式无效'); return; }

      const saveBtn = dialog.querySelector('.et-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      try {
        const result = await this.dataManager.sendMessage('updateTab', {
          tabId: tab.id, groupId, updates: { title: newTitle, url: newUrl }
        });
        if (result && result.success) {
          await this.dataManager.loadData();
          this.render();
          closeDialog();
        } else {
          alert(`保存失败: ${result?.error || '未知错误'}`);
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
      } catch (err) {
        alert(`保存失败: ${err.message || err}`);
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    };

    dialog.querySelector('.et-save-btn').addEventListener('click', saveHandler);
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveHandler();
    });
  }

  /**
   * 刷新并按点击次数排序（持久化到存储）
   */
  async _refreshAndSort() {
    // 调用 background 对数据进行排序并保存
    await this.dataManager.sendMessage('sortTabsByVisitCount');

    // 重新加载数据并渲染
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 查找标签页
   */
  _findTab(tabId) {
    for (const groupId in this.tabs) {
      const tab = this.tabs[groupId].find(t => t.id === tabId);
      if (tab) return tab;
    }
    return null;
  }
}

export default GroupView;
