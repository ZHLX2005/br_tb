/**
 * SearchHelper - 统一搜索工具类
 * 提供模糊匹配、评分排序、高亮等搜索功能
 *
 * 供 TimelineView、background/timeline、focus-search 共用
 */

class SearchHelper {

  // ========== 匹配检测 ==========

  /**
   * 有序模糊匹配（带紧密度约束）
   * 字符必须按顺序出现，且匹配跨度不超过 query.length * 2.5
   */
  static fuzzyMatch(text, query) {
    if (!text || !query) return true;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let textIdx = 0;
    let queryIdx = 0;
    let firstMatch = -1;
    let lastMatch = -1;
    while (textIdx < lowerText.length && queryIdx < lowerQuery.length) {
      if (lowerText[textIdx] === lowerQuery[queryIdx]) {
        if (firstMatch === -1) firstMatch = textIdx;
        lastMatch = textIdx;
        queryIdx++;
      }
      textIdx++;
    }
    if (queryIdx !== lowerQuery.length) return false;
    const span = lastMatch - firstMatch + 1;
    return span <= lowerQuery.length * 2.5;
  }

  /**
   * 精确子串匹配
   */
  static containsMatch(text, query) {
    if (!text || !query) return false;
    return text.toLowerCase().includes(query.toLowerCase());
  }

  // ========== URL 处理 ==========

  /**
   * 提取 URL 的可搜索部分（hostname + pathname，去除 query/hash）
   */
  static getSearchableUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname;
    } catch (e) {
      return url.substring(0, 60);
    }
  }

  // ========== 评分匹配 ==========

  /**
   * 对单个 tab 计算匹配分数和类型
   * @returns {{ score: number, matchType: string }}
   */
  static matchTab(tab, query) {
    const audibleBonus = tab.audible ? 200 : 0;
    if (!query) return { score: 2 + audibleBonus, matchType: '' };
    const q = query.toLowerCase();
    const title = (tab.title || '').toLowerCase();
    const cleanUrl = SearchHelper.getSearchableUrl(tab.url).toLowerCase();
    if (title === q) return { score: 100 + audibleBonus, matchType: 'exact' };
    if (title.startsWith(q)) return { score: 80 + audibleBonus, matchType: 'prefix' };
    if (title.includes(q)) return { score: 60 + audibleBonus, matchType: 'contains' };
    if (cleanUrl.includes(q)) return { score: 40 + audibleBonus, matchType: 'url' };
    if (SearchHelper.fuzzyMatch(tab.title, query)) return { score: 20 + audibleBonus, matchType: 'fuzzy' };
    return { score: audibleBonus > 0 ? audibleBonus : 0, matchType: '' };
  }

  /**
   * 过滤并排序 tab 列表
   * @returns {Array<{ tab: Object, score: number, matchType: string }>}
   */
  static filterAndSort(tabs, query) {
    if (!query || !query.trim()) {
      return tabs.map(t => ({ tab: t, score: 2, matchType: '' }));
    }
    return tabs
      .map(t => {
        const m = SearchHelper.matchTab(t, query);
        return { tab: t, score: m.score, matchType: m.matchType };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  // ========== 搜索快照 ==========

  /**
   * 在快照列表中搜索匹配项
   */
  static searchSnapshots(snapshots, query) {
    if (!query || !query.trim()) return snapshots;
    return snapshots.filter(snapshot =>
      snapshot.tabs.some(tab =>
        SearchHelper.containsMatch(tab.title, query) ||
        SearchHelper.fuzzyMatch(tab.title, query) ||
        SearchHelper.containsMatch(tab.url, query) ||
        SearchHelper.fuzzyMatch(tab.url, query)
      )
    );
  }

  // ========== 高亮 ==========

  /**
   * HTML 转义
   */
  static escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  /**
   * 正则特殊字符转义
   */
  static escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 精确子串高亮（匹配的连续字符串标黄）
   */
  static highlightExact(text, query) {
    if (!query) return SearchHelper.escapeHtml(text);
    const escaped = SearchHelper.escapeHtml(text);
    const regex = new RegExp('(' + SearchHelper.escapeRegex(query) + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  /**
   * 模糊匹配高亮（逐字符标记命中的字母）
   */
  static highlightFuzzy(text, query) {
    if (!text || !query) return SearchHelper.escapeHtml(text);
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let result = '';
    let queryIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (queryIdx < lowerQuery.length && lowerText[i] === lowerQuery[queryIdx]) {
        result += '<mark>' + SearchHelper.escapeHtml(text[i]) + '</mark>';
        queryIdx++;
      } else {
        result += SearchHelper.escapeHtml(text[i]);
      }
    }
    return result;
  }

  /**
   * 智能高亮：根据 matchType 选择对应的高亮方式
   */
  static highlight(text, query, matchType) {
    if (matchType === 'fuzzy') return SearchHelper.highlightFuzzy(text, query);
    return SearchHelper.highlightExact(text, query);
  }
}

export default SearchHelper;
