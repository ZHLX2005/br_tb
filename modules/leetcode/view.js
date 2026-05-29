/**
 * LeetCodeView - LeetCode 150 追踪面板视图
 * 支持3次状态切换：未开始 -> 进行中 -> 已完成 -> 未开始
 */

import { PROBLEM_CATEGORIES, STATUS_LABELS, DIFFICULTY_LABELS, getTotalProblemCount } from './problems-data.js';

const STORAGE_KEY = 'leetcodeProgress';

class LeetCodeView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.progress = {};
    this.filterStatus = 'all';
    this.expandedCategories = new Set();
    this.container = null;
  }

  updateData(data) {
    this.progress = data.leetcodeProgress || {};
  }

  setContainer(container) {
    this.container = container;
  }

  render() {
    if (!this.container) return;
    // 更新头部统计条
    const headerStats = document.getElementById('stats');
    if (headerStats) {
      const s = this._calcStats();
      const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
      headerStats.textContent = `${s.done}/${s.total} 已完成 · ${pct}%`;
    }
    // 首次渲染时默认展开所有分类
    if (this.expandedCategories.size === 0) {
      for (const cat of PROBLEM_CATEGORIES) {
        this.expandedCategories.add(cat.id);
      }
    }
    this.container.innerHTML = this._buildHTML();
    this._bindEvents();
  }

  _buildHTML() {
    const stats = this._calcStats();
    const progressPercent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

    return `
      <div class="leetcode-container">
        <div class="leetcode-header">
          <div class="leetcode-stats">
            <div class="stat-card">
              <div class="stat-value">${stats.total}</div>
              <div class="stat-label">总题数</div>
            </div>
            <div class="stat-card stat-done">
              <div class="stat-value">${stats.done}</div>
              <div class="stat-label">已完成</div>
            </div>
            <div class="stat-card stat-doing">
              <div class="stat-value">${stats.doing}</div>
              <div class="stat-label">进行中</div>
            </div>
            <div class="stat-card stat-todo">
              <div class="stat-value">${stats.todo}</div>
              <div class="stat-label">未开始</div>
            </div>
            <div class="stat-card stat-percent">
              <div class="stat-value">${progressPercent}%</div>
              <div class="stat-label">完成率</div>
            </div>
          </div>
          <div class="leetcode-progress-bar">
            <div class="progress-track">
              <div class="progress-fill" style="width: ${progressPercent}%"></div>
            </div>
          </div>
          <div class="leetcode-filters">
            <button class="filter-btn ${this.filterStatus === 'all' ? 'active' : ''}" data-filter="all">全部</button>
            <button class="filter-btn ${this.filterStatus === 'todo' ? 'active' : ''}" data-filter="todo">未开始</button>
            <button class="filter-btn ${this.filterStatus === 'doing' ? 'active' : ''}" data-filter="doing">进行中</button>
            <button class="filter-btn ${this.filterStatus === 'done' ? 'active' : ''}" data-filter="done">已完成</button>
          </div>
        </div>
        <div class="leetcode-categories">
          ${PROBLEM_CATEGORIES.map(cat => this._buildCategory(cat)).join('')}
        </div>
        ${this._buildEmptyState()}
      </div>
    `;
  }

  _buildCategory(category) {
    const visibleProblems = this._getFilteredProblems(category.problems);
    if (visibleProblems.length === 0) return '';

    const catDone = category.problems.filter(p => (this.progress[p.id] || 0) === 2).length;
    const catPercent = Math.round((catDone / category.problems.length) * 100);
    const isExpanded = this.expandedCategories.has(category.id);

    return `
      <div class="lc-category" data-cat="${category.id}">
        <div class="lc-category-header">
          <div class="lc-category-title">
            <span class="lc-category-toggle">${isExpanded ? '▼' : '▶'}</span>
            <span class="lc-category-name">${category.name}</span>
            <span class="lc-category-count">${visibleProblems.length}/${category.problems.length}</span>
          </div>
          <div class="lc-category-progress">
            <div class="lc-cat-progress-bar">
              <div class="lc-cat-progress-fill" style="width: ${catPercent}%"></div>
            </div>
            <span class="lc-cat-percent">${catPercent}%</span>
          </div>
        </div>
        <div class="lc-problems-list" style="display: ${isExpanded ? 'block' : 'none'}">
          ${visibleProblems.map(p => this._buildProblemRow(p)).join('')}
        </div>
      </div>
    `;
  }

  _buildProblemRow(problem) {
    const status = this.progress[problem.id] || 0;
    const statusInfo = STATUS_LABELS[status];
    const diffInfo = DIFFICULTY_LABELS[problem.difficulty];

    return `
      <div class="lc-problem-row" data-id="${problem.id}">
        <div class="lc-problem-info">
          <span class="lc-problem-diff ${diffInfo.class}">${diffInfo.text}</span>
          <span class="lc-problem-title">${problem.title}</span>
        </div>
        <button class="lc-status-btn ${statusInfo.class}" data-id="${problem.id}" data-status="${status}"
          title="点击切换状态">
          <span class="lc-status-icon">${this._getStatusIcon(status)}</span>
          <span class="lc-status-text">${statusInfo.text}</span>
        </button>
      </div>
    `;
  }

  _getStatusIcon(status) {
    const icons = ['○', '◐', '●'];
    return icons[status] || icons[0];
  }

  _buildEmptyState() {
    const hasVisible = PROBLEM_CATEGORIES.some(cat => this._getFilteredProblems(cat.problems).length > 0);
    if (hasVisible) return '';
    const filterLabels = { all: '题目', todo: '未开始题目', doing: '进行中题目', done: '已完成题目' };
    return `
      <div class="lc-empty-state">
        <div class="lc-empty-icon">[]</div>
        <div class="lc-empty-text">暂无${filterLabels[this.filterStatus] || '题目'}</div>
      </div>
    `;
  }

  _getFilteredProblems(problems) {
    if (this.filterStatus === 'all') return problems;
    const statusMap = { todo: 0, doing: 1, done: 2 };
    const targetStatus = statusMap[this.filterStatus];
    return problems.filter(p => (this.progress[p.id] || 0) === targetStatus);
  }

  _calcStats() {
    const total = getTotalProblemCount();
    let done = 0, doing = 0;
    for (const cat of PROBLEM_CATEGORIES) {
      for (const p of cat.problems) {
        const s = this.progress[p.id] || 0;
        if (s === 2) done++;
        else if (s === 1) doing++;
      }
    }
    return { total, done, doing, todo: total - done - doing };
  }

  _bindEvents() {
    if (!this.container) return;

    // 状态按钮点击 - 3次切换
    this.container.querySelectorAll('.lc-status-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const currentStatus = parseInt(btn.dataset.status, 10);
        const nextStatus = (currentStatus + 1) % 3;
        await this._updateStatus(id, nextStatus);
      });
    });

    // 分类折叠/展开
    this.container.querySelectorAll('.lc-category-header').forEach(header => {
      header.addEventListener('click', () => {
        const catEl = header.closest('.lc-category');
        const catId = catEl.dataset.cat;
        const list = catEl.querySelector('.lc-problems-list');
        const toggle = header.querySelector('.lc-category-toggle');

        if (this.expandedCategories.has(catId)) {
          this.expandedCategories.delete(catId);
          list.style.display = 'none';
          toggle.textContent = '▶';
          catEl.classList.remove('expanded');
        } else {
          this.expandedCategories.add(catId);
          list.style.display = 'block';
          toggle.textContent = '▼';
          catEl.classList.add('expanded');
        }
      });
    });

    // 筛选按钮
    this.container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterStatus = btn.dataset.filter;
        this.render();
      });
    });
  }

  async _updateStatus(problemId, status) {
    this.progress[problemId] = status;

    // 持久化到 storage
    await chrome.storage.local.set({ [STORAGE_KEY]: this.progress });

    // 局部更新 UI（避免全量重渲染）
    const btn = this.container.querySelector(`.lc-status-btn[data-id="${problemId}"]`);
    if (btn) {
      const statusInfo = STATUS_LABELS[status];
      btn.className = `lc-status-btn ${statusInfo.class}`;
      btn.dataset.status = status;
      btn.querySelector('.lc-status-icon').textContent = this._getStatusIcon(status);
      btn.querySelector('.lc-status-text').textContent = statusInfo.text;
    }

    // 更新统计和进度条
    this._updateStatsUI();
    this._updateCategoryProgressUI();
  }

  _updateStatsUI() {
    const stats = this._calcStats();
    const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

    const cards = this.container.querySelectorAll('.stat-value');
    if (cards[0]) cards[0].textContent = stats.total;
    if (cards[1]) cards[1].textContent = stats.done;
    if (cards[2]) cards[2].textContent = stats.doing;
    if (cards[3]) cards[3].textContent = stats.todo;
    if (cards[4]) cards[4].textContent = percent + '%';

    const fill = this.container.querySelector('.progress-fill');
    if (fill) fill.style.width = percent + '%';
  }

  _updateCategoryProgressUI() {
    this.container.querySelectorAll('.lc-category').forEach(catEl => {
      const catId = catEl.dataset.cat;
      const category = PROBLEM_CATEGORIES.find(c => c.id === catId);
      if (!category) return;

      const catDone = category.problems.filter(p => (this.progress[p.id] || 0) === 2).length;
      const catPercent = Math.round((catDone / category.problems.length) * 100);

      const fill = catEl.querySelector('.lc-cat-progress-fill');
      if (fill) fill.style.width = catPercent + '%';

      const percentLabel = catEl.querySelector('.lc-cat-percent');
      if (percentLabel) percentLabel.textContent = catPercent + '%';
    });
  }
}

export default LeetCodeView;
