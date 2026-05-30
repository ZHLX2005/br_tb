/**
 * LC Sidebar — LeetCode 刷题侧边栏
 * 悬浮在页面右侧边缘，hover 展开显示题目列表，点击跳转
 * 依赖 chrome.storage.local 中 settings.showLcSidebar 和 leetcodeProgress
 */

(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-lc-sidebar';
  const PROGRESS_KEY = 'leetcodeProgress';

  // LeetCode CN base
  const LC_BASE = 'https://leetcode.cn/problems/';

  // 问题数据（从 modules/leetcode/problems-data.js 同步）
  const CATEGORIES = [
    { id: 'array-string', name: '数组/字符串', problems: [
      { id: 'lc088', slug: 'merge-sorted-array', title: '合并两个有序数组', diff: 'easy' },
      { id: 'lc027', slug: 'remove-element', title: '移除元素', diff: 'easy' },
      { id: 'lc026', slug: 'remove-duplicates-from-sorted-array', title: '删除有序数组中的重复项', diff: 'easy' },
      { id: 'lc080', slug: 'remove-duplicates-from-sorted-array-ii', title: '删除有序数组中的重复项 II', diff: 'medium' },
      { id: 'lc169', slug: 'majority-element', title: '多数元素', diff: 'easy' },
      { id: 'lc189', slug: 'rotate-array', title: '轮转数组', diff: 'medium' },
      { id: 'lc121', slug: 'best-time-to-buy-and-sell-stock', title: '买卖股票的最佳时机', diff: 'easy' },
      { id: 'lc122', slug: 'best-time-to-buy-and-sell-stock-ii', title: '买卖股票的最佳时机 II', diff: 'medium' },
      { id: 'lc055', slug: 'jump-game', title: '跳跃游戏', diff: 'medium' },
      { id: 'lc045', slug: 'jump-game-ii', title: '跳跃游戏 II', diff: 'medium' },
      { id: 'lc274', slug: 'h-index', title: 'H 指数', diff: 'medium' },
      { id: 'lc380', slug: 'insert-delete-getrandom-o1', title: 'O(1) 时间插入删除和获取随机元素', diff: 'medium' },
      { id: 'lc238', slug: 'product-of-array-except-self', title: '除了自身以外数组的乘积', diff: 'medium' },
      { id: 'lc134', slug: 'gas-station', title: '加油站', diff: 'medium' },
      { id: 'lc135', slug: 'candy', title: '分发糖果', diff: 'hard' },
      { id: 'lc042', slug: 'trapping-rain-water', title: '接雨水', diff: 'hard' },
      { id: 'lc013', slug: 'roman-to-integer', title: '罗马数字转整数', diff: 'easy' },
      { id: 'lc012', slug: 'integer-to-roman', title: '整数转罗马数字', diff: 'medium' },
      { id: 'lc058', slug: 'length-of-last-word', title: '最后一个单词的长度', diff: 'easy' },
      { id: 'lc014', slug: 'longest-common-prefix', title: '最长公共前缀', diff: 'easy' },
      { id: 'lc151', slug: 'reverse-words-in-a-string', title: '反转字符串中的单词', diff: 'medium' },
      { id: 'lc006', slug: 'zigzag-conversion', title: 'Z 字形变换', diff: 'medium' },
      { id: 'lc028', slug: 'find-the-index-of-the-first-occurrence-in-a-string', title: '找出字符串中第一个匹配项的下标', diff: 'easy' },
      { id: 'lc068', slug: 'text-justification', title: '文本左右对齐', diff: 'hard' },
    ]},
    { id: 'two-pointers', name: '双指针', problems: [
      { id: 'lc125', slug: 'valid-palindrome', title: '验证回文串', diff: 'easy' },
      { id: 'lc392', slug: 'is-subsequence', title: '判断子序列', diff: 'easy' },
      { id: 'lc167', slug: 'two-sum-ii-input-array-is-sorted', title: '两数之和 II', diff: 'medium' },
      { id: 'lc011', slug: 'container-with-most-water', title: '盛最多水的容器', diff: 'medium' },
      { id: 'lc015', slug: '3sum', title: '三数之和', diff: 'medium' },
    ]},
    { id: 'sliding-window', name: '滑动窗口', problems: [
      { id: 'lc209', slug: 'minimum-size-subarray-sum', title: '长度最小的子数组', diff: 'medium' },
      { id: 'lc003', slug: 'longest-substring-without-repeating-characters', title: '无重复字符的最长子串', diff: 'medium' },
      { id: 'lc030', slug: 'substring-with-concatenation-of-all-words', title: '串联所有单词的子串', diff: 'hard' },
      { id: 'lc076', slug: 'minimum-window-substring', title: '最小覆盖子串', diff: 'hard' },
    ]},
    { id: 'matrix', name: '矩阵', problems: [
      { id: 'lc036', slug: 'valid-sudoku', title: '有效的数独', diff: 'medium' },
      { id: 'lc054', slug: 'spiral-matrix', title: '螺旋矩阵', diff: 'medium' },
      { id: 'lc048', slug: 'rotate-image', title: '旋转图像', diff: 'medium' },
      { id: 'lc073', slug: 'set-matrix-zeroes', title: '矩阵置零', diff: 'medium' },
      { id: 'lc289', slug: 'game-of-life', title: '生命游戏', diff: 'medium' },
    ]},
    { id: 'hash-table', name: '哈希表', problems: [
      { id: 'lc383', slug: 'ransom-note', title: '赎金信', diff: 'easy' },
      { id: 'lc205', slug: 'isomorphic-strings', title: '同构字符串', diff: 'easy' },
      { id: 'lc290', slug: 'word-pattern', title: '单词规律', diff: 'easy' },
      { id: 'lc242', slug: 'valid-anagram', title: '有效的字母异位词', diff: 'easy' },
      { id: 'lc049', slug: 'group-anagrams', title: '字母异位词分组', diff: 'medium' },
      { id: 'lc001', slug: 'two-sum', title: '两数之和', diff: 'easy' },
      { id: 'lc202', slug: 'happy-number', title: '快乐数', diff: 'easy' },
      { id: 'lc219', slug: 'contains-duplicate-ii', title: '存在重复元素 II', diff: 'easy' },
      { id: 'lc128', slug: 'longest-consecutive-sequence', title: '最长连续序列', diff: 'medium' },
    ]},
    { id: 'intervals', name: '区间', problems: [
      { id: 'lc228', slug: 'summary-ranges', title: '汇总区间', diff: 'easy' },
      { id: 'lc056', slug: 'merge-intervals', title: '合并区间', diff: 'medium' },
      { id: 'lc057', slug: 'insert-interval', title: '插入区间', diff: 'medium' },
      { id: 'lc452', slug: 'minimum-number-of-arrows-to-burst-balloons', title: '用最少数量的箭引爆气球', diff: 'medium' },
    ]},
    { id: 'stack', name: '栈', problems: [
      { id: 'lc020', slug: 'valid-parentheses', title: '有效的括号', diff: 'easy' },
      { id: 'lc071', slug: 'simplify-path', title: '简化路径', diff: 'medium' },
      { id: 'lc155', slug: 'min-stack', title: '最小栈', diff: 'medium' },
      { id: 'lc150', slug: 'evaluate-reverse-polish-notation', title: '逆波兰表达式求值', diff: 'medium' },
      { id: 'lc224', slug: 'basic-calculator', title: '基本计算器', diff: 'hard' },
    ]},
    { id: 'linked-list', name: '链表', problems: [
      { id: 'lc141', slug: 'linked-list-cycle', title: '环形链表', diff: 'easy' },
      { id: 'lc002', slug: 'add-two-numbers', title: '两数相加', diff: 'medium' },
      { id: 'lc021', slug: 'merge-two-sorted-lists', title: '合并两个有序链表', diff: 'easy' },
      { id: 'lc138', slug: 'copy-list-with-random-pointer', title: '随机链表的复制', diff: 'medium' },
      { id: 'lc092', slug: 'reverse-linked-list-ii', title: '反转链表 II', diff: 'medium' },
      { id: 'lc025', slug: 'reverse-nodes-in-k-group', title: 'K 个一组翻转链表', diff: 'hard' },
      { id: 'lc019', slug: 'remove-nth-node-from-end-of-list', title: '删除链表的倒数第 N 个结点', diff: 'medium' },
      { id: 'lc082', slug: 'remove-duplicates-from-sorted-list-ii', title: '删除排序链表中的重复元素 II', diff: 'medium' },
      { id: 'lc061', slug: 'rotate-list', title: '旋转链表', diff: 'medium' },
      { id: 'lc086', slug: 'partition-list', title: '分隔链表', diff: 'medium' },
      { id: 'lc146', slug: 'lru-cache', title: 'LRU 缓存', diff: 'medium' },
    ]},
    { id: 'binary-tree', name: '二叉树', problems: [
      { id: 'lc104', slug: 'maximum-depth-of-binary-tree', title: '二叉树的最大深度', diff: 'easy' },
      { id: 'lc100', slug: 'same-tree', title: '相同的树', diff: 'easy' },
      { id: 'lc226', slug: 'invert-binary-tree', title: '翻转二叉树', diff: 'easy' },
      { id: 'lc101', slug: 'symmetric-tree', title: '对称二叉树', diff: 'easy' },
      { id: 'lc105', slug: 'construct-binary-tree-from-preorder-and-inorder-traversal', title: '从前序与中序遍历序列构造二叉树', diff: 'medium' },
      { id: 'lc106', slug: 'construct-binary-tree-from-inorder-and-postorder-traversal', title: '从中序与后序遍历序列构造二叉树', diff: 'medium' },
      { id: 'lc117', slug: 'populating-next-right-pointers-in-each-node-ii', title: '填充每个节点的下一个右侧节点指针 II', diff: 'medium' },
      { id: 'lc114', slug: 'flatten-binary-tree-to-linked-list', title: '二叉树展开为链表', diff: 'medium' },
      { id: 'lc112', slug: 'path-sum', title: '路径总和', diff: 'easy' },
      { id: 'lc129', slug: 'sum-root-to-leaf-numbers', title: '求根节点到叶节点数字之和', diff: 'medium' },
      { id: 'lc124', slug: 'binary-tree-maximum-path-sum', title: '二叉树中的最大路径和', diff: 'hard' },
      { id: 'lc173', slug: 'binary-search-tree-iterator', title: '二叉搜索树迭代器', diff: 'medium' },
      { id: 'lc222', slug: 'count-complete-tree-nodes', title: '完全二叉树的节点个数', diff: 'easy' },
      { id: 'lc236', slug: 'lowest-common-ancestor-of-a-binary-tree', title: '二叉树的最近公共祖先', diff: 'medium' },
    ]},
    { id: 'tree-bfs', name: '二叉树层次遍历', problems: [
      { id: 'lc199', slug: 'binary-tree-right-side-view', title: '二叉树的右视图', diff: 'medium' },
      { id: 'lc637', slug: 'average-of-levels-in-binary-tree', title: '二叉树的层平均值', diff: 'easy' },
      { id: 'lc102', slug: 'binary-tree-level-order-traversal', title: '二叉树的层序遍历', diff: 'medium' },
      { id: 'lc103', slug: 'binary-tree-zigzag-level-order-traversal', title: '二叉树的锯齿形层序遍历', diff: 'medium' },
    ]},
    { id: 'bst', name: '二叉搜索树', problems: [
      { id: 'lc530', slug: 'minimum-absolute-difference-in-bst', title: '二叉搜索树的最小绝对差', diff: 'easy' },
      { id: 'lc230', slug: 'kth-smallest-element-in-a-bst', title: '二叉搜索树中第 K 小的元素', diff: 'medium' },
      { id: 'lc098', slug: 'validate-binary-search-tree', title: '验证二叉搜索树', diff: 'medium' },
    ]},
    { id: 'graph', name: '图', problems: [
      { id: 'lc200', slug: 'number-of-islands', title: '岛屿数量', diff: 'medium' },
      { id: 'lc130', slug: 'surrounded-regions', title: '被围绕的区域', diff: 'medium' },
      { id: 'lc133', slug: 'clone-graph', title: '克隆图', diff: 'medium' },
      { id: 'lc399', slug: 'evaluate-division', title: '除法求值', diff: 'medium' },
      { id: 'lc207', slug: 'course-schedule', title: '课程表', diff: 'medium' },
      { id: 'lc210', slug: 'course-schedule-ii', title: '课程表 II', diff: 'medium' },
    ]},
    { id: 'graph-bfs', name: '图的广度优先搜索', problems: [
      { id: 'lc909', slug: 'snakes-and-ladders', title: '蛇梯棋', diff: 'medium' },
      { id: 'lc433', slug: 'minimum-genetic-mutation', title: '最小基因变化', diff: 'medium' },
      { id: 'lc127', slug: 'word-ladder', title: '单词接龙', diff: 'hard' },
    ]},
    { id: 'trie', name: '字典树', problems: [
      { id: 'lc208', slug: 'implement-trie-prefix-tree', title: '实现 Trie (前缀树)', diff: 'medium' },
      { id: 'lc211', slug: 'design-add-and-search-words-data-structure', title: '添加与搜索单词 - 数据结构设计', diff: 'medium' },
      { id: 'lc212', slug: 'word-search-ii', title: '单词搜索 II', diff: 'hard' },
    ]},
    { id: 'backtracking', name: '回溯', problems: [
      { id: 'lc017', slug: 'letter-combinations-of-a-phone-number', title: '电话号码的字母组合', diff: 'medium' },
      { id: 'lc077', slug: 'combinations', title: '组合', diff: 'medium' },
      { id: 'lc046', slug: 'permutations', title: '全排列', diff: 'medium' },
      { id: 'lc039', slug: 'combination-sum', title: '组合总和', diff: 'medium' },
      { id: 'lc052', slug: 'n-queens-ii', title: 'N 皇后 II', diff: 'hard' },
      { id: 'lc022', slug: 'generate-parentheses', title: '括号生成', diff: 'medium' },
      { id: 'lc079', slug: 'word-search', title: '单词搜索', diff: 'medium' },
    ]},
    { id: 'divide-conquer', name: '分治', problems: [
      { id: 'lc108', slug: 'convert-sorted-array-to-binary-search-tree', title: '将有序数组转换为二叉搜索树', diff: 'easy' },
      { id: 'lc148', slug: 'sort-list', title: '排序链表', diff: 'medium' },
      { id: 'lc427', slug: 'construct-quad-tree', title: '建立四叉树', diff: 'medium' },
      { id: 'lc023', slug: 'merge-k-sorted-lists', title: '合并 K 个升序链表', diff: 'hard' },
    ]},
    { id: 'kadane', name: 'Kadane 算法', problems: [
      { id: 'lc053', slug: 'maximum-subarray', title: '最大子数组和', diff: 'medium' },
      { id: 'lc918', slug: 'maximum-sum-circular-subarray', title: '环形子数组的最大和', diff: 'medium' },
    ]},
    { id: 'binary-search', name: '二分查找', problems: [
      { id: 'lc035', slug: 'search-insert-position', title: '搜索插入位置', diff: 'easy' },
      { id: 'lc074', slug: 'search-a-2d-matrix', title: '搜索二维矩阵', diff: 'medium' },
      { id: 'lc162', slug: 'find-peak-element', title: '寻找峰值', diff: 'medium' },
      { id: 'lc033', slug: 'search-in-rotated-sorted-array', title: '搜索旋转排序数组', diff: 'medium' },
      { id: 'lc034', slug: 'find-first-and-last-position-of-element-in-sorted-array', title: '在排序数组中查找元素的第一个和最后一个位置', diff: 'medium' },
      { id: 'lc153', slug: 'find-minimum-in-rotated-sorted-array', title: '寻找旋转排序数组中的最小值', diff: 'medium' },
      { id: 'lc004', slug: 'median-of-two-sorted-arrays', title: '寻找两个正序数组的中位数', diff: 'hard' },
    ]},
    { id: 'heap', name: '堆', problems: [
      { id: 'lc215', slug: 'kth-largest-element-in-an-array', title: '数组中的第K个最大元素', diff: 'medium' },
      { id: 'lc502', slug: 'ipo', title: 'IPO', diff: 'hard' },
      { id: 'lc373', slug: 'find-k-pairs-with-smallest-sums', title: '查找和最小的 K 对数字', diff: 'medium' },
      { id: 'lc295', slug: 'find-median-from-data-stream', title: '数据流的中位数', diff: 'hard' },
    ]},
    { id: 'bitwise', name: '位运算', problems: [
      { id: 'lc067', slug: 'add-binary', title: '二进制求和', diff: 'easy' },
      { id: 'lc190', slug: 'reverse-bits', title: '颠倒二进制位', diff: 'easy' },
      { id: 'lc191', slug: 'number-of-1-bits', title: '位1的个数', diff: 'easy' },
      { id: 'lc136', slug: 'single-number', title: '只出现一次的数字', diff: 'easy' },
      { id: 'lc137', slug: 'single-number-ii', title: '只出现一次的数字 II', diff: 'medium' },
      { id: 'lc201', slug: 'bitwise-and-of-numbers-range', title: '数字范围按位与', diff: 'medium' },
    ]},
    { id: 'math', name: '数学', problems: [
      { id: 'lc009', slug: 'palindrome-number', title: '回文数', diff: 'easy' },
      { id: 'lc066', slug: 'plus-one', title: '加一', diff: 'easy' },
      { id: 'lc172', slug: 'factorial-trailing-zeroes', title: '阶乘后的零', diff: 'medium' },
      { id: 'lc069', slug: 'sqrtx', title: 'x 的平方根', diff: 'easy' },
      { id: 'lc050', slug: 'powx-n', title: 'Pow(x, n)', diff: 'medium' },
      { id: 'lc149', slug: 'max-points-on-a-line', title: '直线上最多的点数', diff: 'hard' },
    ]},
    { id: 'dp-1d', name: '一维动态规划', problems: [
      { id: 'lc070', slug: 'climbing-stairs', title: '爬楼梯', diff: 'easy' },
      { id: 'lc198', slug: 'house-robber', title: '打家劫舍', diff: 'medium' },
      { id: 'lc139', slug: 'word-break', title: '单词拆分', diff: 'medium' },
      { id: 'lc322', slug: 'coin-change', title: '零钱兑换', diff: 'medium' },
      { id: 'lc300', slug: 'longest-increasing-subsequence', title: '最长递增子序列', diff: 'medium' },
    ]},
    { id: 'dp-multi', name: '多维动态规划', problems: [
      { id: 'lc120', slug: 'triangle', title: '三角形最小路径和', diff: 'medium' },
      { id: 'lc064', slug: 'minimum-path-sum', title: '最小路径和', diff: 'medium' },
      { id: 'lc063', slug: 'unique-paths-ii', title: '不同路径 II', diff: 'medium' },
      { id: 'lc005', slug: 'longest-palindromic-substring', title: '最长回文子串', diff: 'medium' },
      { id: 'lc097', slug: 'interleaving-string', title: '交错字符串', diff: 'medium' },
      { id: 'lc072', slug: 'edit-distance', title: '编辑距离', diff: 'medium' },
      { id: 'lc123', slug: 'best-time-to-buy-and-sell-stock-iii', title: '买卖股票的最佳时机 III', diff: 'hard' },
      { id: 'lc188', slug: 'best-time-to-buy-and-sell-stock-iv', title: '买卖股票的最佳时机 IV', diff: 'hard' },
      { id: 'lc221', slug: 'maximal-square', title: '最大正方形', diff: 'medium' },
    ]},
  ];

  // 扁平列表便于快速查找
  const ALL_PROBLEMS = CATEGORIES.flatMap(cat =>
    cat.problems.map(p => ({ ...p, catId: cat.id, catName: cat.name }))
  );

  const DIFF_LABELS = { easy: '简', medium: '中', hard: '难' };
  const STATUS_ICONS = { 0: '○', 1: '◐', 2: '●' };

  // id→slug 映射（progress 用 id 做 key）
  const ID_MAP = {};
  CATEGORIES.forEach(cat => cat.problems.forEach(p => { ID_MAP[p.id] = p.slug; }));
  const ALL_IDS = Object.keys(ID_MAP);

  let progress = {};
  let isEnabled = false;
  let wrapper = null;

  // ===================== Styles =====================
  const STYLES = `
    #${WRAPPER_ID} {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 999999;
      display: flex;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --accent: #42a5f5;
    }
    #${WRAPPER_ID}-dots {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px 4px;
      cursor: pointer;
      margin-right: 22px;
      flex-shrink: 0;
    }
    #${WRAPPER_ID}-dots .lc-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(93,67,88,0.2);
      transition: all 300ms cubic-bezier(.34, 1.56, .64, 1);
    }
    #${WRAPPER_ID}-dots .lc-dot.active {
      background: var(--accent);
      transform: scale(1.6);
      box-shadow: 0 0 6px rgba(66,165,245,0.5);
    }
    #${WRAPPER_ID}-dots .lc-dot.done {
      background: #66bb6a;
      transform: scale(1.2);
    }
    #${WRAPPER_ID}-panel {
      width: 240px;
      max-height: 70vh;
      overflow-y: auto;
      background: white;
      border-radius: 10px 0 0 10px;
      box-shadow: -2px 4px 20px rgba(0,0,0,0.18);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateX(10px);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s linear 240ms;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    #${WRAPPER_ID}-panel::-webkit-scrollbar { display: none; }
    #${WRAPPER_ID}:hover #${WRAPPER_ID}-panel,
    #${WRAPPER_ID}.expanded #${WRAPPER_ID}-panel {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateX(0);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s;
    }
    #${WRAPPER_ID}-header {
      padding: 10px 12px 8px;
      border-bottom: 1px solid #eee;
      position: sticky;
      top: 0;
      background: white;
      z-index: 1;
    }
    #${WRAPPER_ID}-title {
      font-size: 12px;
      font-weight: 600;
      color: #333;
    }
    #${WRAPPER_ID}-stats {
      font-size: 10px;
      color: #888;
      margin-top: 2px;
    }
    #${WRAPPER_ID}-search {
      width: 100%;
      padding: 5px 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      font-size: 11px;
      margin-top: 6px;
      box-sizing: border-box;
    }
    #${WRAPPER_ID}-search:focus { outline: none; border-color: var(--accent); }
    #${WRAPPER_ID}-todo {
      padding: 6px 10px;
      border-bottom: 1px solid #f0f0f0;
      background: #fafafa;
    }
    #${WRAPPER_ID}-todo-title {
      font-size: 10px;
      color: #888;
      font-weight: 500;
      margin-bottom: 4px;
    }
    #${WRAPPER_ID}-todo-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lc-todo-item {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      color: #555;
      transition: background 120ms;
    }
    .lc-todo-item:hover { background: #e3f2fd; color: var(--accent); }
    .lc-todo-item .lc-prob-icon { font-size: 10px; flex-shrink: 0; }
    .lc-todo-item .lc-prob-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lc-todo-item .lc-prob-diff {
      font-size: 9px; font-weight: 600; padding: 1px 4px; border-radius: 2px; flex-shrink: 0;
    }
    .lc-prob-diff.easy { background: #e8f5e9; color: #2e7d32; }
    .lc-prob-diff.medium { background: #fff3e0; color: #e65100; }
    .lc-prob-diff.hard { background: #ffebee; color: #c62828; }
    #${WRAPPER_ID}-cats { padding: 4px 0; }
    .lc-cat-group {}
    .lc-cat-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 11px;
      color: #555;
      background: #fafafa;
      border-bottom: 1px solid #f0f0f0;
      user-select: none;
      transition: background 120ms;
    }
    .lc-cat-header:hover { background: #eee; }
    .lc-cat-toggle { font-size: 8px; color: #aaa; width: 10px; text-align: center; transition: transform 200ms; }
    .lc-cat-group.open .lc-cat-toggle { transform: rotate(90deg); }
    .lc-cat-name { flex: 1; font-weight: 500; }
    .lc-cat-count { font-size: 9px; color: #bbb; }
    .lc-cat-done { font-size: 9px; color: #81c784; }
    .lc-problem-list { display: none; padding: 2px 0; }
    .lc-cat-group.open .lc-problem-list { display: block; }
    .lc-prob-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 18px;
      cursor: pointer;
      font-size: 11px;
      color: #444;
      transition: background 120ms;
    }
    .lc-prob-item:hover { background: #e3f2fd; color: var(--accent); }
    .lc-prob-item.status-done { color: #81c784; }
    .lc-prob-item.status-doing { color: #ff9800; }
    .lc-prob-icon { font-size: 10px; flex-shrink: 0; width: 12px; text-align: center; }
    .lc-prob-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lc-open-panel-btn {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      margin: 4px 0;
      transition: opacity 120ms;
    }
    .lc-open-panel-btn:hover { opacity: 0.85; }
  `;

  // ===================== Build DOM =====================
  function buildSidebar() {
    if (wrapper) return;

    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;

    // Dot indicator - 3 dots reflecting overall progress
    const dots = document.createElement('div');
    dots.id = WRAPPER_ID + '-dots';
    updateDots(dots);
    dots.addEventListener('click', () => wrapper.classList.toggle('expanded'));

    // Panel
    const panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';

    const total = ALL_PROBLEMS.length;
    const done = ALL_PROBLEMS.filter(p => (progress[p.id] || 0) === 2).length;
    const doing = ALL_PROBLEMS.filter(p => (progress[p.id] || 0) === 1).length;

    panel.innerHTML = `
      <div id="${WRAPPER_ID}-header">
        <div id="${WRAPPER_ID}-title">LeetCode 150</div>
        <button id="${WRAPPER_ID}-open-panel" class="lc-open-panel-btn">打开面板</button>
        <div id="${WRAPPER_ID}-stats">${done} 已完成 · ${doing} 进行中 · ${total} 总计</div>
        <input type="text" id="${WRAPPER_ID}-search" placeholder="搜索题目...">
      </div>
      ${buildTodoSection()}
      <div id="${WRAPPER_ID}-cats">
        ${CATEGORIES.map(cat => buildCategoryHTML(cat)).join('')}
      </div>
    `;

    wrapper.appendChild(dots);
    wrapper.appendChild(panel);
    document.body.appendChild(wrapper);

    // Search filter
    const searchInput = document.getElementById(WRAPPER_ID + '-search');
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('.lc-prob-item').forEach(item => {
        const match = !q || item.dataset.title.toLowerCase().includes(q) || item.dataset.slug.toLowerCase().includes(q);
        item.style.display = match ? '' : 'none';
      });
      document.querySelectorAll('.lc-cat-group').forEach(cat => {
        const visible = [...cat.querySelectorAll('.lc-prob-item')].some(i => i.style.display !== 'none');
        cat.style.display = visible ? '' : 'none';
      });
    });

    // 打开面板按钮
    document.getElementById(WRAPPER_ID + '-open-panel').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openTabboard', view: 'leetcode' });
    });

    // Category collapse
    document.querySelectorAll('.lc-cat-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.closest('.lc-cat-group');
        group.classList.toggle('open');
        const toggle = header.querySelector('.lc-cat-toggle');
        if (toggle) toggle.textContent = group.classList.contains('open') ? '▼' : '▶';
      });
    });

    // Problem click
    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.lc-prob-item, .lc-todo-item');
      if (!item) return;
      const slug = item.dataset.slug;
      window.open(LC_BASE + slug + '/', '_blank');
    });

    // Enter on search opens first result
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = document.querySelector('.lc-prob-item[style=""], .lc-prob-item:not([style="display: none"])');
        if (first) window.open(LC_BASE + first.dataset.slug + '/', '_blank');
      }
    });
  }

  function buildTodoSection() {
    // Get first 5 status=0 (not started) problems
    const todoProblems = ALL_PROBLEMS
      .filter(p => (progress[p.id] || 0) === 0)
      .slice(0, 5);

    if (todoProblems.length === 0) return '';

    return `
      <div id="${WRAPPER_ID}-todo">
        <div class="${WRAPPER_ID}-todo-title">推荐刷题 ▼</div>
        <div id="${WRAPPER_ID}-todo-list">
          ${todoProblems.map(p => `
            <div class="lc-todo-item" data-slug="${p.slug}" data-title="${p.title}">
              <span class="lc-prob-icon">○</span>
              <span class="lc-prob-title">${p.title}</span>
              <span class="lc-prob-diff ${p.diff}">${DIFF_LABELS[p.diff]}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function updateDots(dotsEl) {
    if (!dotsEl) dotsEl = document.getElementById(WRAPPER_ID + '-dots');
    if (!dotsEl) return;

    const total = ALL_PROBLEMS.length;
    const done = ALL_PROBLEMS.filter(p => (progress[p.id] || 0) === 2).length;
    const percent = total > 0 ? done / total : 0;

    // 3 dots: based on progress levels
    const dots = dotsEl.querySelectorAll('.lc-dot');
    const levels = [0.33, 0.66, 1.0];
    dots.forEach((dot, i) => {
      dot.classList.remove('active', 'done');
      if (percent >= levels[i]) {
        dot.classList.add('done');
      } else if (i === 0) {
        dot.classList.add('active');
      }
    });
  }

  function buildCategoryHTML(cat) {
    const done = cat.problems.filter(p => (progress[p.id] || 0) === 2).length;
    const total = cat.problems.length;
    return `
      <div class="lc-cat-group open" data-cat="${cat.id}">
        <div class="lc-cat-header">
          <span class="lc-cat-toggle">▼</span>
          <span class="lc-cat-name">${cat.name}</span>
          <span class="lc-cat-count">${done}/${total}</span>
        </div>
        <div class="lc-problem-list">
          ${cat.problems.map(p => buildProblemHTML(p)).join('')}
        </div>
      </div>
    `;
  }

  function buildProblemHTML(p) {
    const status = progress[p.id] || 0;
    const cls = status === 2 ? 'status-done' : status === 1 ? 'status-doing' : '';
    return `
      <div class="lc-prob-item ${cls}" data-slug="${p.slug}" data-title="${p.title}">
        <span class="lc-prob-icon">${STATUS_ICONS[status]}</span>
        <span class="lc-prob-title">${p.title}</span>
        <span class="lc-prob-diff ${p.diff}">${DIFF_LABELS[p.diff]}</span>
      </div>
    `;
  }

  function refreshStats() {
    if (!wrapper) return;
    const total = ALL_PROBLEMS.length;
    const done = ALL_PROBLEMS.filter(p => (progress[p.id] || 0) === 2).length;
    const doing = ALL_PROBLEMS.filter(p => (progress[p.id] || 0) === 1).length;
    const statsEl = document.getElementById(WRAPPER_ID + '-stats');
    if (statsEl) statsEl.textContent = `${done} 已完成 · ${doing} 进行中 · ${total} 总计`;

    // Refresh todo section
    const oldTodo = document.getElementById(WRAPPER_ID + '-todo');
    const newTodoHTML = buildTodoSection();
    if (oldTodo && newTodoHTML) {
      oldTodo.outerHTML = newTodoHTML;
    } else if (!oldTodo && newTodoHTML) {
      const header = document.getElementById(WRAPPER_ID + '-header');
      const cats = document.getElementById(WRAPPER_ID + '-cats');
      if (header && cats) {
        const temp = document.createElement('div');
        temp.innerHTML = newTodoHTML;
        header.after(temp.firstElementChild);
      }
    }

    // Refresh cat counts
    document.querySelectorAll('.lc-cat-group').forEach(catEl => {
      const catId = catEl.dataset.cat;
      const cat = CATEGORIES.find(c => c.id === catId);
      if (!cat) return;
      const doneCount = cat.problems.filter(p => (progress[p.id] || 0) === 2).length;
      const countEl = catEl.querySelector('.lc-cat-count');
      if (countEl) countEl.textContent = `${doneCount}/${cat.problems.length}`;
      const items = catEl.querySelectorAll('.lc-prob-item');
      items.forEach(item => {
        const slug = item.dataset.slug;
        const s = progress[slug] || 0;
        item.className = `lc-prob-item ${s === 2 ? 'status-done' : s === 1 ? 'status-doing' : ''}`;
        item.querySelector('.lc-prob-icon').textContent = STATUS_ICONS[s];
      });
    });

    // Refresh dots
    updateDots();
  }

  function removeSidebar() {
    if (wrapper) { wrapper.remove(); wrapper = null; }
  }

  // ===================== Init =====================
  async function init() {
    try {
      const [settingsRes, progressRes] = await Promise.all([
        chrome.runtime.sendMessage({ action: 'getSettings' }),
        chrome.storage.local.get([PROGRESS_KEY])
      ]);

      const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
      isEnabled = !!settings.showLcSidebar;
      progress = progressRes[PROGRESS_KEY] || {};

      if (!isEnabled) { removeSidebar(); return; }

      buildSidebar();
    } catch (err) {
      // Extension context may be invalid
    }
  }

  // ===================== Listeners =====================
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    if (changes[PROGRESS_KEY]) {
      progress = changes[PROGRESS_KEY].newValue || {};
      refreshStats();
    }

    if (changes.settings) {
      const newSettings = changes.settings.newValue || {};
      const newEnabled = !!newSettings.showLcSidebar;
      if (newEnabled !== isEnabled) {
        isEnabled = newEnabled;
        if (isEnabled) init();
        else removeSidebar();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
