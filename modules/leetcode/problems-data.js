/**
 * LeetCode 150 题目数据
 * 按分类组织，每个题目有唯一 id、标题和难度
 */

export const PROBLEM_CATEGORIES = [
  {
    id: 'array-string',
    name: '数组 / 字符串',
    problems: [
      { id: 'lc088', title: '合并两个有序数组', difficulty: 'easy' },
      { id: 'lc027', title: '移除元素', difficulty: 'easy' },
      { id: 'lc026', title: '删除有序数组中的重复项', difficulty: 'easy' },
      { id: 'lc080', title: '删除有序数组中的重复项 II', difficulty: 'medium' },
      { id: 'lc169', title: '多数元素', difficulty: 'easy' },
      { id: 'lc189', title: '轮转数组', difficulty: 'medium' },
      { id: 'lc121', title: '买卖股票的最佳时机', difficulty: 'easy' },
      { id: 'lc122', title: '买卖股票的最佳时机 II', difficulty: 'medium' },
      { id: 'lc055', title: '跳跃游戏', difficulty: 'medium' },
      { id: 'lc045', title: '跳跃游戏 II', difficulty: 'medium' },
      { id: 'lc274', title: 'H 指数', difficulty: 'medium' },
      { id: 'lc380', title: 'O(1) 时间插入、删除和获取随机元素', difficulty: 'medium' },
      { id: 'lc238', title: '除了自身以外数组的乘积', difficulty: 'medium' },
      { id: 'lc134', title: '加油站', difficulty: 'medium' },
      { id: 'lc135', title: '分发糖果', difficulty: 'hard' },
      { id: 'lc042', title: '接雨水', difficulty: 'hard' },
      { id: 'lc013', title: '罗马数字转整数', difficulty: 'easy' },
      { id: 'lc012', title: '整数转罗马数字', difficulty: 'medium' },
      { id: 'lc058', title: '最后一个单词的长度', difficulty: 'easy' },
      { id: 'lc014', title: '最长公共前缀', difficulty: 'easy' },
      { id: 'lc151', title: '反转字符串中的单词', difficulty: 'medium' },
      { id: 'lc006', title: 'Z 字形变换', difficulty: 'medium' },
      { id: 'lc028', title: '找出字符串中第一个匹配项的下标', difficulty: 'easy' },
      { id: 'lc068', title: '文本左右对齐', difficulty: 'hard' },
    ]
  },
  {
    id: 'two-pointers',
    name: '双指针',
    problems: [
      { id: 'lc125', title: '验证回文串', difficulty: 'easy' },
      { id: 'lc392', title: '判断子序列', difficulty: 'easy' },
      { id: 'lc167', title: '两数之和 II - 输入有序数组', difficulty: 'medium' },
      { id: 'lc011', title: '盛最多水的容器', difficulty: 'medium' },
      { id: 'lc015', title: '三数之和', difficulty: 'medium' },
    ]
  },
  {
    id: 'sliding-window',
    name: '滑动窗口',
    problems: [
      { id: 'lc209', title: '长度最小的子数组', difficulty: 'medium' },
      { id: 'lc003', title: '无重复字符的最长子串', difficulty: 'medium' },
      { id: 'lc030', title: '串联所有单词的子串', difficulty: 'hard' },
      { id: 'lc076', title: '最小覆盖子串', difficulty: 'hard' },
    ]
  },
  {
    id: 'matrix',
    name: '矩阵',
    problems: [
      { id: 'lc036', title: '有效的数独', difficulty: 'medium' },
      { id: 'lc054', title: '螺旋矩阵', difficulty: 'medium' },
      { id: 'lc048', title: '旋转图像', difficulty: 'medium' },
      { id: 'lc073', title: '矩阵置零', difficulty: 'medium' },
      { id: 'lc289', title: '生命游戏', difficulty: 'medium' },
    ]
  },
  {
    id: 'hash-table',
    name: '哈希表',
    problems: [
      { id: 'lc383', title: '赎金信', difficulty: 'easy' },
      { id: 'lc205', title: '同构字符串', difficulty: 'easy' },
      { id: 'lc290', title: '单词规律', difficulty: 'easy' },
      { id: 'lc242', title: '有效的字母异位词', difficulty: 'easy' },
      { id: 'lc049', title: '字母异位词分组', difficulty: 'medium' },
      { id: 'lc001', title: '两数之和', difficulty: 'easy' },
      { id: 'lc202', title: '快乐数', difficulty: 'easy' },
      { id: 'lc219', title: '存在重复元素 II', difficulty: 'easy' },
      { id: 'lc128', title: '最长连续序列', difficulty: 'medium' },
    ]
  },
  {
    id: 'intervals',
    name: '区间',
    problems: [
      { id: 'lc228', title: '汇总区间', difficulty: 'easy' },
      { id: 'lc056', title: '合并区间', difficulty: 'medium' },
      { id: 'lc057', title: '插入区间', difficulty: 'medium' },
      { id: 'lc452', title: '用最少数量的箭引爆气球', difficulty: 'medium' },
    ]
  },
  {
    id: 'stack',
    name: '栈',
    problems: [
      { id: 'lc020', title: '有效的括号', difficulty: 'easy' },
      { id: 'lc071', title: '简化路径', difficulty: 'medium' },
      { id: 'lc155', title: '最小栈', difficulty: 'medium' },
      { id: 'lc150', title: '逆波兰表达式求值', difficulty: 'medium' },
      { id: 'lc224', title: '基本计算器', difficulty: 'hard' },
    ]
  },
  {
    id: 'linked-list',
    name: '链表',
    problems: [
      { id: 'lc141', title: '环形链表', difficulty: 'easy' },
      { id: 'lc002', title: '两数相加', difficulty: 'medium' },
      { id: 'lc021', title: '合并两个有序链表', difficulty: 'easy' },
      { id: 'lc138', title: '随机链表的复制', difficulty: 'medium' },
      { id: 'lc092', title: '反转链表 II', difficulty: 'medium' },
      { id: 'lc025', title: 'K 个一组翻转链表', difficulty: 'hard' },
      { id: 'lc019', title: '删除链表的倒数第 N 个结点', difficulty: 'medium' },
      { id: 'lc082', title: '删除排序链表中的重复元素 II', difficulty: 'medium' },
      { id: 'lc061', title: '旋转链表', difficulty: 'medium' },
      { id: 'lc086', title: '分隔链表', difficulty: 'medium' },
      { id: 'lc146', title: 'LRU 缓存', difficulty: 'medium' },
    ]
  },
  {
    id: 'binary-tree',
    name: '二叉树',
    problems: [
      { id: 'lc104', title: '二叉树的最大深度', difficulty: 'easy' },
      { id: 'lc100', title: '相同的树', difficulty: 'easy' },
      { id: 'lc226', title: '翻转二叉树', difficulty: 'easy' },
      { id: 'lc101', title: '对称二叉树', difficulty: 'easy' },
      { id: 'lc105', title: '从前序与中序遍历序列构造二叉树', difficulty: 'medium' },
      { id: 'lc106', title: '从中序与后序遍历序列构造二叉树', difficulty: 'medium' },
      { id: 'lc117', title: '填充每个节点的下一个右侧节点指针 II', difficulty: 'medium' },
      { id: 'lc114', title: '二叉树展开为链表', difficulty: 'medium' },
      { id: 'lc112', title: '路径总和', difficulty: 'easy' },
      { id: 'lc129', title: '求根节点到叶节点数字之和', difficulty: 'medium' },
      { id: 'lc124', title: '二叉树中的最大路径和', difficulty: 'hard' },
      { id: 'lc173', title: '二叉搜索树迭代器', difficulty: 'medium' },
      { id: 'lc222', title: '完全二叉树的节点个数', difficulty: 'easy' },
      { id: 'lc236', title: '二叉树的最近公共祖先', difficulty: 'medium' },
    ]
  },
  {
    id: 'tree-bfs',
    name: '二叉树层次遍历',
    problems: [
      { id: 'lc199', title: '二叉树的右视图', difficulty: 'medium' },
      { id: 'lc637', title: '二叉树的层平均值', difficulty: 'easy' },
      { id: 'lc102', title: '二叉树的层序遍历', difficulty: 'medium' },
      { id: 'lc103', title: '二叉树的锯齿形层序遍历', difficulty: 'medium' },
    ]
  },
  {
    id: 'bst',
    name: '二叉搜索树',
    problems: [
      { id: 'lc530', title: '二叉搜索树的最小绝对差', difficulty: 'easy' },
      { id: 'lc230', title: '二叉搜索树中第 K 小的元素', difficulty: 'medium' },
      { id: 'lc098', title: '验证二叉搜索树', difficulty: 'medium' },
    ]
  },
  {
    id: 'graph',
    name: '图',
    problems: [
      { id: 'lc200', title: '岛屿数量', difficulty: 'medium' },
      { id: 'lc130', title: '被围绕的区域', difficulty: 'medium' },
      { id: 'lc133', title: '克隆图', difficulty: 'medium' },
      { id: 'lc399', title: '除法求值', difficulty: 'medium' },
      { id: 'lc207', title: '课程表', difficulty: 'medium' },
      { id: 'lc210', title: '课程表 II', difficulty: 'medium' },
    ]
  },
  {
    id: 'graph-bfs',
    name: '图的广度优先搜索',
    problems: [
      { id: 'lc909', title: '蛇梯棋', difficulty: 'medium' },
      { id: 'lc433', title: '最小基因变化', difficulty: 'medium' },
      { id: 'lc127', title: '单词接龙', difficulty: 'hard' },
    ]
  },
  {
    id: 'trie',
    name: '字典树',
    problems: [
      { id: 'lc208', title: '实现 Trie (前缀树)', difficulty: 'medium' },
      { id: 'lc211', title: '添加与搜索单词 - 数据结构设计', difficulty: 'medium' },
      { id: 'lc212', title: '单词搜索 II', difficulty: 'hard' },
    ]
  },
  {
    id: 'backtracking',
    name: '回溯',
    problems: [
      { id: 'lc017', title: '电话号码的字母组合', difficulty: 'medium' },
      { id: 'lc077', title: '组合', difficulty: 'medium' },
      { id: 'lc046', title: '全排列', difficulty: 'medium' },
      { id: 'lc039', title: '组合总和', difficulty: 'medium' },
      { id: 'lc052', title: 'N 皇后 II', difficulty: 'hard' },
      { id: 'lc022', title: '括号生成', difficulty: 'medium' },
      { id: 'lc079', title: '单词搜索', difficulty: 'medium' },
    ]
  },
  {
    id: 'divide-conquer',
    name: '分治',
    problems: [
      { id: 'lc108', title: '将有序数组转换为二叉搜索树', difficulty: 'easy' },
      { id: 'lc148', title: '排序链表', difficulty: 'medium' },
      { id: 'lc427', title: '建立四叉树', difficulty: 'medium' },
      { id: 'lc023', title: '合并 K 个升序链表', difficulty: 'hard' },
    ]
  },
  {
    id: 'kadane',
    name: 'Kadane 算法',
    problems: [
      { id: 'lc053', title: '最大子数组和', difficulty: 'medium' },
      { id: 'lc918', title: '环形子数组的最大和', difficulty: 'medium' },
    ]
  },
  {
    id: 'binary-search',
    name: '二分查找',
    problems: [
      { id: 'lc035', title: '搜索插入位置', difficulty: 'easy' },
      { id: 'lc074', title: '搜索二维矩阵', difficulty: 'medium' },
      { id: 'lc162', title: '寻找峰值', difficulty: 'medium' },
      { id: 'lc033', title: '搜索旋转排序数组', difficulty: 'medium' },
      { id: 'lc034', title: '在排序数组中查找元素的第一个和最后一个位置', difficulty: 'medium' },
      { id: 'lc153', title: '寻找旋转排序数组中的最小值', difficulty: 'medium' },
      { id: 'lc004', title: '寻找两个正序数组的中位数', difficulty: 'hard' },
    ]
  },
  {
    id: 'heap',
    name: '堆',
    problems: [
      { id: 'lc215', title: '数组中的第K个最大元素', difficulty: 'medium' },
      { id: 'lc502', title: 'IPO', difficulty: 'hard' },
      { id: 'lc373', title: '查找和最小的 K 对数字', difficulty: 'medium' },
      { id: 'lc295', title: '数据流的中位数', difficulty: 'hard' },
    ]
  },
  {
    id: 'bitwise',
    name: '位运算',
    problems: [
      { id: 'lc067', title: '二进制求和', difficulty: 'easy' },
      { id: 'lc190', title: '颠倒二进制位', difficulty: 'easy' },
      { id: 'lc191', title: '位1的个数', difficulty: 'easy' },
      { id: 'lc136', title: '只出现一次的数字', difficulty: 'easy' },
      { id: 'lc137', title: '只出现一次的数字 II', difficulty: 'medium' },
      { id: 'lc201', title: '数字范围按位与', difficulty: 'medium' },
    ]
  },
  {
    id: 'math',
    name: '数学',
    problems: [
      { id: 'lc009', title: '回文数', difficulty: 'easy' },
      { id: 'lc066', title: '加一', difficulty: 'easy' },
      { id: 'lc172', title: '阶乘后的零', difficulty: 'medium' },
      { id: 'lc069', title: 'x 的平方根', difficulty: 'easy' },
      { id: 'lc050', title: 'Pow(x, n)', difficulty: 'medium' },
      { id: 'lc149', title: '直线上最多的点数', difficulty: 'hard' },
    ]
  },
  {
    id: 'dp-1d',
    name: '一维动态规划',
    problems: [
      { id: 'lc070', title: '爬楼梯', difficulty: 'easy' },
      { id: 'lc198', title: '打家劫舍', difficulty: 'medium' },
      { id: 'lc139', title: '单词拆分', difficulty: 'medium' },
      { id: 'lc322', title: '零钱兑换', difficulty: 'medium' },
      { id: 'lc300', title: '最长递增子序列', difficulty: 'medium' },
    ]
  },
  {
    id: 'dp-multi',
    name: '多维动态规划',
    problems: [
      { id: 'lc120', title: '三角形最小路径和', difficulty: 'medium' },
      { id: 'lc064', title: '最小路径和', difficulty: 'medium' },
      { id: 'lc063', title: '不同路径 II', difficulty: 'medium' },
      { id: 'lc005', title: '最长回文子串', difficulty: 'medium' },
      { id: 'lc097', title: '交错字符串', difficulty: 'medium' },
      { id: 'lc072', title: '编辑距离', difficulty: 'medium' },
      { id: 'lc123', title: '买卖股票的最佳时机 III', difficulty: 'hard' },
      { id: 'lc188', title: '买卖股票的最佳时机 IV', difficulty: 'hard' },
      { id: 'lc221', title: '最大正方形', difficulty: 'medium' },
    ]
  }
];

export const STATUS_LABELS = {
  0: { text: '未开始', class: 'status-todo' },
  1: { text: '进行中', class: 'status-doing' },
  2: { text: '已完成', class: 'status-done' }
};

export const DIFFICULTY_LABELS = {
  easy: { text: '简单', class: 'diff-easy' },
  medium: { text: '中等', class: 'diff-medium' },
  hard: { text: '困难', class: 'diff-hard' }
};

export function getTotalProblemCount() {
  return PROBLEM_CATEGORIES.reduce((sum, cat) => sum + cat.problems.length, 0);
}
