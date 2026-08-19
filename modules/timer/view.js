/**
 * TimerView - 时间日志视图（GitHub 热力图风格）
 * 以天为粒度聚合计时数据，支持年/月/周/日四种维度
 */

// 热力图色阶（0 / 1-10min / 10-30min / 30-60min / 60+min）
var HEAT_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
var HEAT_LABELS = ['0 min', '1-10m', '10-30m', '30-60m', '60m+'];

// 星期简写（周一开始，匹配 GitHub）
var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

class TimerView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.container = null;
    this.sessions = [];

    // 视图状态
    this.viewMode = 'year'; // 'year' | 'month' | 'week' | 'day'
    this.viewDate = new Date(); // 当前聚焦的日期
    this.today = new Date();
    this.today.setHours(0, 0, 0, 0);
  }

  updateData(data) {
    // timerSessions 和 timerState 不在 DataManager 中
    // 直接从 chrome.storage.local 读取
    this.sessions = data.timerSessions || [];
  }

  setContainer(container) {
    this.container = container;
  }

  // ========== 主渲染入口 ==========

  render() {
    if (!this.container) return;

    var self = this;
    // 从 storage 读取（DataManager 不包含 timerSessions key）
    chrome.storage.local.get(['timerSessions'], function (result) {
      self.sessions = result.timerSessions || [];

      var headerStats = document.getElementById('stats');
      if (headerStats) {
        var total = self._calcTotalTime(self.sessions);
        headerStats.textContent = '总计 ' + self._formatDurationShort(total);
      }

      self.container.innerHTML = self._buildHTML();
      self._bindEvents();
    });
  }

  // ========== HTML 构建 ==========

  _buildHTML() {
    var stats = this._calcStats(this.sessions);
    var modeHtml = this._buildViewContent();

    return (
      '<div class="timer-container">' +
      this._buildStatsRow(stats) +
      this._buildControls() +
      '<div class="timer-view-content">' + modeHtml + '</div>' +
      '<div class="timer-sessions-list">' + this._buildRecentSessions() + '</div>' +
      '</div>'
    );
  }

  // ---------- 统计行 ----------

  _buildStatsRow(stats) {
    var todayTotal = this._calcDayTotal(this.sessions, this._todayKey());
    return (
      '<div class="timer-stats-row">' +
      '<div class="timer-stat-card"><div class="timer-stat-val">' + this._formatDurationShort(stats.total) + '</div><div class="timer-stat-lbl">总计时</div></div>' +
      '<div class="timer-stat-card"><div class="timer-stat-val">' + this._formatDurationShort(stats.avgPerDay) + '</div><div class="timer-stat-lbl">日均</div></div>' +
      '<div class="timer-stat-card"><div class="timer-stat-val">' + stats.streak + 'd</div><div class="timer-stat-lbl">连续</div></div>' +
      '<div class="timer-stat-card"><div class="timer-stat-val">' + this._formatDurationShort(todayTotal) + '</div><div class="timer-stat-lbl">今天</div></div>' +
      '</div>'
    );
  }

  // ---------- 控制栏 ----------

  _buildControls() {
    var modes = [
      { key: 'year', label: '年' },
      { key: 'month', label: '月' },
      { key: 'week', label: '周' },
      { key: 'day', label: '日' }
    ];
    var modeBtns = '';
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      var cls = m.key === this.viewMode ? 'tm-mode-btn active' : 'tm-mode-btn';
      modeBtns += '<button class="' + cls + '" data-mode="' + m.key + '">' + m.label + '</button>';
    }

    var navLabel = this._getNavLabel();
    return (
      '<div class="timer-controls">' +
      '<div class="timer-nav">' +
      '<button class="tm-nav-btn" data-dir="prev">&#9664;</button>' +
      '<span class="tm-nav-label">' + this._escapeHtml(navLabel) + '</span>' +
      '<button class="tm-nav-btn" data-dir="next">&#9654;</button>' +
      '<button class="tm-nav-btn tm-today-btn" data-dir="today">今天</button>' +
      '</div>' +
      '<div class="tm-mode-group">' + modeBtns + '</div>' +
      '</div>'
    );
  }

  // ---------- 视图内容 ----------

  _buildViewContent() {
    switch (this.viewMode) {
      case 'year': return this._buildYearHeatmap();
      case 'month': return this._buildMonthHeatmap();
      case 'week': return this._buildWeekView();
      case 'day': return this._buildDayView();
      default: return this._buildYearHeatmap();
    }
  }

  // ---- 年视图（GitHub 热力图风格） ----

  _buildYearHeatmap() {
    var year = this.viewDate.getFullYear();
    var startDate = new Date(year, 0, 1);
    // 找到第一个周一之前的周日（GitHub 风格：第一列从周一开始）
    var startDay = startDate.getDay(); // 0=Sun
    var offset = startDay === 0 ? 6 : startDay - 1; // 从周一开始的偏移
    var firstCell = new Date(startDate);
    firstCell.setDate(firstCell.getDate() - offset);

    var endDate = new Date(year + 1, 0, 0);
    // 找到最后一周的周日
    var lastDay = endDate.getDay();
    var endOffset = lastDay === 0 ? 0 : 7 - lastDay;
    var lastCell = new Date(endDate);
    lastCell.setDate(lastCell.getDate() + endOffset);

    // 计算周数
    var totalDays = Math.round((lastCell - firstCell) / 86400000);
    var weeks = Math.ceil(totalDays / 7);
    if (weeks < 52) weeks = 52;

    // 聚合一年数据
    var dailyMap = this._buildDailyMap(this.sessions, year);

    // 月标签行
    var monthLabels = '';
    var currentMonth = -1;
    for (var w = 0; w < weeks; w++) {
      var cellDate = new Date(firstCell);
      cellDate.setDate(cellDate.getDate() + w * 7);
      var m = cellDate.getMonth();
      var label = '';
      if (m !== currentMonth) {
        currentMonth = m;
        label = MONTH_NAMES[m];
      }
      monthLabels += '<div class="tm-ml-cell" style="font-size:9px">' + this._escapeHtml(label) + '</div>';
    }

    // 行标签 + 单元格
    var gridRows = '';
    for (var row = 0; row < 7; row++) {
      var dayCells = '';
      for (var col = 0; col < weeks; col++) {
        var d = new Date(firstCell);
        d.setDate(d.getDate() + col * 7 + row);
        var dateKey = this._dateKey(d);
        var min = dailyMap[dateKey] || 0;
        var level = this._heatLevel(min);
        var title = this._dateLabel(d) + ': ' + this._formatDurationShort(min * 60);
        var isToday = dateKey === this._todayKey() ? ' tm-cell-today' : '';
        dayCells += '<div class="tm-cell lvl-' + level + isToday + '" title="' + this._escapeHtml(title) + '"></div>';
      }
      var rowLabel = row < DAY_SHORT.length ? DAY_SHORT[row] : '';
      gridRows +=
        '<div class="tm-row">' +
        '<div class="tm-row-label">' + (row % 2 === 0 ? rowLabel : '') + '</div>' +
        '<div class="tm-row-cells">' + dayCells + '</div>' +
        '</div>';
    }

    return (
      '<div class="tm-heatmap">' +
      '<div class="tm-month-labels">' + monthLabels + '</div>' +
      '<div class="tm-grid">' + gridRows + '</div>' +
      '<div class="tm-legend">' +
      '<span style="font-size:10px;color:#999">少</span>' +
      '<div class="tm-legend-cell lvl-0"></div>' +
      '<div class="tm-legend-cell lvl-1"></div>' +
      '<div class="tm-legend-cell lvl-2"></div>' +
      '<div class="tm-legend-cell lvl-3"></div>' +
      '<div class="tm-legend-cell lvl-4"></div>' +
      '<span style="font-size:10px;color:#999">多</span>' +
      '</div>' +
      '</div>'
    );
  }

  // ---- 月视图 ----

  _buildMonthHeatmap() {
    var year = this.viewDate.getFullYear();
    var month = this.viewDate.getMonth();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    var startOffset = firstDay === 0 ? 6 : firstDay - 1;

    var dailyMap = this._buildDailyMap(this.sessions, year, month);

    // 行标签
    var rowsHtml = '';
    for (var r = 0; r < 7; r++) {
      var cells = '';
      for (var c = 0; c < 7; c++) {
        var dayNum = r + c * 7 - startOffset + 1;
        if (dayNum < 1 || dayNum > daysInMonth) {
          cells += '<div class="tm-cell tm-cell-empty"></div>';
          continue;
        }
        var d = new Date(year, month, dayNum);
        var dateKey = this._dateKey(d);
        var min = dailyMap[dateKey] || 0;
        var level = this._heatLevel(min);

        // 计算从第几列开始
        var col = Math.floor((startOffset + dayNum - 1) / 7);
        if (c !== col) continue;

        var title = this._dateLabel(d) + ': ' + this._formatDurationShort(min * 60);
        var isToday = dateKey === this._todayKey() ? ' tm-cell-today' : '';
        cells += '<div class="tm-cell lvl-' + level + isToday + '" title="' + this._escapeHtml(title) + '">' + dayNum + '</div>';
      }
      var rowLabel = DAY_SHORT[r] || '';
      rowsHtml +=
        '<div class="tm-row">' +
        '<div class="tm-row-label">' + rowLabel + '</div>' +
        '<div class="tm-month-row-cells">' + cells + '</div>' +
        '</div>';
    }

    return (
      '<div class="tm-heatmap">' +
      '<div class="tm-grid tm-month-grid">' + rowsHtml + '</div>' +
      '<div class="tm-legend">' +
      '<span style="font-size:10px;color:#999">少</span>' +
      '<div class="tm-legend-cell lvl-0"></div>' +
      '<div class="tm-legend-cell lvl-1"></div>' +
      '<div class="tm-legend-cell lvl-2"></div>' +
      '<div class="tm-legend-cell lvl-3"></div>' +
      '<div class="tm-legend-cell lvl-4"></div>' +
      '<span style="font-size:10px;color:#999">多</span>' +
      '</div>' +
      '</div>'
    );
  }

  // ---- 周视图 ----

  _buildWeekView() {
    var self = this;
    // 找到当前周一的日期
    var dayOfWeek = this.viewDate.getDay(); // 0=Sun
    var monOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    var monday = new Date(this.viewDate);
    monday.setDate(monday.getDate() + monOffset);

    var dailyMap = {};
    for (var d = 0; d < 7; d++) {
      var date = new Date(monday);
      date.setDate(date.getDate() + d);
      var key = this._dateKey(date);
      dailyMap[key] = this._calcDayTotal(this.sessions, key);
    }

    var rows = '';
    for (var i = 0; i < 7; i++) {
      var dt = new Date(monday);
      dt.setDate(dt.getDate() + i);
      var k = this._dateKey(dt);
      var min = dailyMap[k] || 0;
      var level = this._heatLevel(min);
      var isToday = k === this._todayKey() ? ' tm-cell-today' : '';

      rows +=
        '<div class="tm-week-row">' +
        '<div class="tm-week-label">' + DAY_SHORT[i] + ' ' + dt.getDate() + '</div>' +
        '<div class="tm-week-bar">' +
        '<div class="tm-week-fill lvl-' + level + '" style="width:' + Math.min(min / 60 * 100, 100) + '%">' +
        '<span class="tm-week-val">' + self._formatDurationShort(min * 60) + '</span>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    return (
      '<div class="tm-week-view">' +
      '<div class="tm-week-header">' +
      this._escapeHtml(MONTH_NAMES[monday.getMonth()]) + ' ' + monday.getDate() + ' - ' +
      this._escapeHtml(MONTH_NAMES[monday.getMonth()]) + ' ' + (new Date(monday.getTime() + 6 * 86400000).getDate()) +
      '</div>' +
      '<div class="tm-week-body">' + rows + '</div>' +
      '</div>'
    );
  }

  // ---- 日视图 ----

  _buildDayView() {
    var self = this;
    var dateKey = this._dateKey(this.viewDate);
    var daySessions = this._getDaySessions(this.sessions, dateKey);
    var totalMin = this._calcDayTotal(this.sessions, dateKey);
    var isToday = dateKey === this._todayKey();

    var listHtml = '';
    if (daySessions.length === 0) {
      listHtml = '<div class="tm-day-empty">该日无记录</div>';
    } else {
      for (var i = 0; i < daySessions.length; i++) {
        var s = daySessions[i];
        var start = new Date(s.startTime);
        var end = new Date(s.endTime);
        var startStr = (start.getHours() < 10 ? '0' : '') + start.getHours() + ':' + (start.getMinutes() < 10 ? '0' : '') + start.getMinutes();
        var endStr = (end.getHours() < 10 ? '0' : '') + end.getHours() + ':' + (end.getMinutes() < 10 ? '0' : '') + end.getMinutes();
        var durStr = self._formatDurationShort(s.duration);
        listHtml +=
          '<div class="tm-session-row" data-session-id="' + self._escapeHtml(s.id) + '">' +
          '<span class="tm-session-time">' + startStr + ' - ' + endStr + '</span>' +
          '<span class="tm-session-dur">' + durStr + '</span>' +
          '<button class="tm-session-del" data-session-id="' + self._escapeHtml(s.id) + '" title="删除此条">×</button>' +
          '</div>';
      }
    }

    var dateLabel = this._dateLabel(this.viewDate) + (isToday ? ' (今天)' : '');

    return (
      '<div class="tm-day-view">' +
      '<div class="tm-day-header">' +
      '<div class="tm-day-title">' + this._escapeHtml(dateLabel) + '</div>' +
      '<div class="tm-day-total">总计时: ' + this._formatDurationShort(totalMin * 60) + '</div>' +
      '</div>' +
      '<div class="tm-day-sessions">' + listHtml + '</div>' +
      '</div>'
    );
  }

  // ---- 近期记录列表 ----

  _buildRecentSessions() {
    var self = this;
    if (this.sessions.length === 0) {
      return '<div class="tm-empty">暂无记录，在任意页面使用计时圆环开始记时</div>';
    }

    var limit = Math.min(this.sessions.length, 20);
    var items = '';
    for (var i = 0; i < limit; i++) {
      var s = this.sessions[i];
      var d = new Date(s.endTime);
      var dateStr = d.getFullYear() + '-' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
      var timeStr = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
      var durStr = self._formatDurationShort(s.duration);
      items +=
        '<div class="tm-recent-row" data-session-id="' + self._escapeHtml(s.id) + '">' +
        '<span class="tm-recent-date">' + dateStr + '</span>' +
        '<span class="tm-recent-time">' + timeStr + '</span>' +
        '<span class="tm-recent-dur">' + durStr + '</span>' +
        '<button class="tm-session-del" data-session-id="' + self._escapeHtml(s.id) + '" title="删除此条">×</button>' +
        '</div>';
    }

    return (
      '<div class="tm-recent-header">最近记录 <span class="tm-recent-count">共 ' + this.sessions.length + ' 条</span></div>' +
      '<div class="tm-recent-body">' + items + '</div>'
    );
  }

  // ========== 事件绑定 ==========

  _bindEvents() {
    if (!this.container) return;

    var self = this;

    // 模式切换
    var modeBtns = this.container.querySelectorAll('.tm-mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          self.viewMode = btn.dataset.mode;
          self.render();
        });
      })(modeBtns[i]);
    }

    // 导航按钮
    var navBtns = this.container.querySelectorAll('.tm-nav-btn');
    for (var j = 0; j < navBtns.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var dir = btn.dataset.dir;
          if (dir === 'today') {
            self.viewDate = new Date();
            self.viewDate.setHours(0, 0, 0, 0);
          } else {
            self._navigate(dir);
          }
          self.render();
        });
      })(navBtns[j]);
    }

    // 删除按钮
    var delBtns = this.container.querySelectorAll('.tm-session-del');
    for (var k = 0; k < delBtns.length; k++) {
      (function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.dataset.sessionId;
          if (id) self._deleteSession(id);
        });
      })(delBtns[k]);
    }
  }

  // ========== 数据工具 ==========

  _navigate(dir) {
    var delta = dir === 'prev' ? -1 : 1;
    switch (this.viewMode) {
      case 'year':
        this.viewDate.setFullYear(this.viewDate.getFullYear() + delta);
        break;
      case 'month':
        this.viewDate.setMonth(this.viewDate.getMonth() + delta);
        break;
      case 'week':
        this.viewDate.setDate(this.viewDate.getDate() + delta * 7);
        break;
      case 'day':
        this.viewDate.setDate(this.viewDate.getDate() + delta);
        break;
    }
  }

  _getNavLabel() {
    switch (this.viewMode) {
      case 'year': return this.viewDate.getFullYear() + '';
      case 'month': return this.viewDate.getFullYear() + ' ' + MONTH_NAMES[this.viewDate.getMonth()];
      case 'week': {
        var dayOfWeek = this.viewDate.getDay();
        var monOff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        var mon = new Date(this.viewDate);
        mon.setDate(mon.getDate() + monOff);
        return MONTH_NAMES[mon.getMonth()] + ' W' + this._weekNumber(mon);
      }
      case 'day': return this._dateLabel(this.viewDate);
      default: return '';
    }
  }

  _weekNumber(d) {
    var first = new Date(d.getFullYear(), 0, 1);
    var dayOfYear = Math.round((d - first) / 86400000);
    // ISO week number approximation
    return Math.ceil((dayOfYear + first.getDay() + 1) / 7);
  }

  _dateKey(d) {
    return d.getFullYear() + '-' +
      ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '-' +
      (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  _dateLabel(d) {
    return d.getFullYear() + '/' +
      ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '/' +
      (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  _todayKey() {
    return this._dateKey(this.today);
  }

  _buildDailyMap(sessions, year, month) {
    var map = {};
    var prefix = year + '-';
    var prefixLen = prefix.length;

    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s.endTime) continue;
      var d = new Date(s.endTime);
      if (d.getFullYear() !== year) continue;
      if (month !== undefined && d.getMonth() !== month) continue;

      var key = this._dateKey(d);
      map[key] = (map[key] || 0) + Math.round(s.duration / 60); // 累计分钟
    }
    return map;
  }

  _calcDayTotal(sessions, dateKey) {
    var total = 0;
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s.endTime) continue;
      var d = new Date(s.endTime);
      if (this._dateKey(d) === dateKey) {
        total += Math.round(s.duration / 60);
      }
    }
    return total;
  }

  _getDaySessions(sessions, dateKey) {
    var result = [];
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s.endTime) continue;
      var d = new Date(s.endTime);
      if (this._dateKey(d) === dateKey) {
        result.push(s);
      }
    }
    return result;
  }

  _calcTotalTime(sessions) {
    var total = 0;
    for (var i = 0; i < sessions.length; i++) {
      total += sessions[i].duration || 0;
    }
    return total; // seconds
  }

  _calcStats(sessions) {
    var total = this._calcTotalTime(sessions); // seconds
    var totalMin = total / 60;

    // Unique days
    var daySet = {};
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s.endTime) continue;
      daySet[this._dateKey(new Date(s.endTime))] = true;
    }
    var dayKeys = Object.keys(daySet);
    var dayCount = dayKeys.length;

    // 连续天数（从今天往前）
    var streak = 0;
    var checkDate = new Date(this.today);
    for (var s = 0; s < 365; s++) {
      var key = this._dateKey(checkDate);
      if (daySet[key]) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    var avgPerDay = dayCount > 0 ? totalMin / dayCount : 0;

    return {
      total: total,
      avgPerDay: avgPerDay * 60,
      streak: streak
    };
  }

  _heatLevel(minutes) {
    if (minutes <= 0) return 0;
    if (minutes <= 10) return 1;
    if (minutes <= 30) return 2;
    if (minutes <= 60) return 3;
    return 4;
  }

  _deleteSession(sessionId) {
    if (!sessionId || !this.sessions.length) return;
    var self = this;
    // 从缓存中移除
    this.sessions = this.sessions.filter(function (s) { return s.id !== sessionId; });
    // 持久化
    chrome.storage.local.set({ timerSessions: this.sessions }, function () {
      self.render();
    });
  }

  _formatDurationShort(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    var totalMin = Math.round(seconds / 60);
    if (totalMin < 60) return totalMin + 'm';
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'm';
  }

  _escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export default TimerView;
