/**
 * Goto Ring Settings — 悬浮 goto 圆环个性化设置领域层
 *
 * 管理右下角悬浮 goto 圆环(content/inject/goto/goto.js 的 #tabboard-goto-ring-circle)的
 * 大小 + 背景图。设置入口在侧边栏 goto 管理圆环(content/gotoManagerRing.js 的 ⚙ 面板)里,
 * 本文件是数据的唯一读写入口(遵循 group-model 规约,不散写 settings.read-modify-write)。
 *
 * 数据字段(写在 chrome.storage.local.settings 下):
 *   settings.gotoRingSize: 'xxs'(24) | 'xs'(32) | 'sm'(48) | 'md'(60) | 'lg'(72) | 'xl'(84),默认 'md'
 *   settings.gotoRingBg:   null(默认,圆环正常显示 ☰)
 *                          | { type:'custom', data:'data:image/...' }(上传后,背景图生效 + ☰ 隐藏)
 */

const RING_SIZE_PX = { xxs: 24, xs: 32, sm: 48, md: 60, lg: 72, xl: 84 };
const VALID_SIZES = new Set(Object.keys(RING_SIZE_PX));

function isValidSize(s) {
  return VALID_SIZES.has(s);
}

function isValidBg(bg) {
  if (bg === null || bg === undefined) return true;
  if (typeof bg !== 'object') return false;
  if (bg.type === 'custom' && typeof bg.data === 'string' && bg.data.startsWith('data:image/')) return true;
  return false;
}

/**
 * 读当前悬浮 goto 圆环完整设置(size + bg)。缺失字段给默认值。
 */
async function getGotoRingSettings() {
  const { settings } = await chrome.storage.local.get(['settings']);
  const s = settings || {};
  const size = isValidSize(s.gotoRingSize) ? s.gotoRingSize : 'md';
  const bg = isValidBg(s.gotoRingBg) ? s.gotoRingBg : null;
  return { size, bg };
}

/**
 * 更新悬浮圆环大小。校验失败抛 Error 让 message adapter 返回失败。
 */
async function updateGotoRingSize(size) {
  if (!isValidSize(size)) {
    throw new Error(`Invalid size: ${size} (allowed: ${[...VALID_SIZES].join(', ')})`);
  }
  const { settings } = await chrome.storage.local.get(['settings']);
  const next = { ...(settings || {}), gotoRingSize: size };
  await chrome.storage.local.set({ settings: next });
  return { size };
}

/**
 * 更新悬浮圆环背景图。
 * - bg = null → 恢复默认(圆环 ☰ 正常显示)
 * - bg = {type:'custom', data} → 背景图生效(+ ☰ 隐藏),data 为 base64 且 < 100KB
 *   (96x96 PNG 实测 15-26KB,100KB 是防御上限,收紧给 storage 留空间)
 */
async function updateGotoRingBg(bg) {
  if (!isValidBg(bg)) {
    throw new Error('Invalid bg: must be null or {type:"custom", data:"data:image/..."}');
  }
  if (bg && bg.type === 'custom' && bg.data.length > 100 * 1024) {
    throw new Error(`Custom bg too large: ${bg.data.length} bytes (limit 100KB)`);
  }
  const { settings } = await chrome.storage.local.get(['settings']);
  const next = { ...(settings || {}), gotoRingBg: bg };
  await chrome.storage.local.set({ settings: next });
  return { bg };
}

/**
 * 将 size 枚举映射成像素值,供 content script 应用。
 */
function getGotoRingSizePx(size) {
  return RING_SIZE_PX[isValidSize(size) ? size : 'md'];
}

export {
  getGotoRingSettings,
  updateGotoRingSize,
  updateGotoRingBg,
  getGotoRingSizePx,
  // 暴露给测试/调试
  isValidSize,
  isValidBg,
  RING_SIZE_PX
};