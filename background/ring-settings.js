/**
 * Goto Ring Settings — 悬浮 goto 圆环个性化设置领域层
 *
 * 管理右下角悬浮 goto 圆环(content/inject/goto/goto.js 的 #tabboard-goto-ring-circle)的
 * 大小 + 背景图。设置入口在侧边栏 goto 管理圆环(content/gotoManagerRing.js 的 ⚙ 面板)里,
 * 本文件是数据的唯一读写入口(遵循 group-model 规约,不散写 settings.read-modify-write)。
 *
 * 数据字段(写在 chrome.storage.local.settings 下):
 *   settings.gotoRingSize: 整数像素值,范围 [RING_MIN_PX, RING_MAX_PX],默认 60
 *                          (历史版本是字符串 enum 'xxs'/'xs'/'sm'/'md'/'lg'/'xl',
 *                          在 getGotoRingSettings / updateGotoRingSize 内做兼容,老值一次性迁移到数字)
 *   settings.gotoRingBg:   null(默认,圆环正常显示 ☰)
 *                          | { type:'custom', data:'data:image/...' }(上传后,背景图生效 + ☰ 隐藏)
 *   settings.gotoRingSettingsExpanded: boolean,默认 false
 *                          (goto 管理圆环 ⚙ 面板的展开/收起状态,跨 tab + 跨刷新持久化)
 */

const RING_MIN_PX = 24;
const RING_MAX_PX = 96;
const RING_DEFAULT_PX = 60;

// 旧 enum → 像素映射,迁移用(历史版本存储的字符串值)
const LEGACY_ENUM_PX = { xxs: 24, xs: 32, sm: 48, md: 60, lg: 72, xl: 84 };

function clampSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return RING_DEFAULT_PX;
  const rounded = Math.round(n);
  if (rounded < RING_MIN_PX) return RING_MIN_PX;
  if (rounded > RING_MAX_PX) return RING_MAX_PX;
  return rounded;
}

function isValidBg(bg) {
  if (bg === null || bg === undefined) return true;
  if (typeof bg !== 'object') return false;
  if (bg.type === 'custom' && typeof bg.data === 'string' && bg.data.startsWith('data:image/')) return true;
  return false;
}

/**
 * 读当前悬浮 goto 圆环完整设置(size + bg + 面板展开状态)。缺失字段给默认值;旧 enum size 自动迁移到像素。
 */
async function getGotoRingSettings() {
  const { settings } = await chrome.storage.local.get(['settings']);
  const s = settings || {};
  // size:可能是数字(新)、字符串 enum(老)、undefined
  let size;
  if (typeof s.gotoRingSize === 'number') {
    size = clampSize(s.gotoRingSize);
  } else if (typeof s.gotoRingSize === 'string' && s.gotoRingSize in LEGACY_ENUM_PX) {
    size = LEGACY_ENUM_PX[s.gotoRingSize]; // 迁移:老 enum 直接落到对应像素
  } else {
    size = RING_DEFAULT_PX;
  }
  const bg = isValidBg(s.gotoRingBg) ? s.gotoRingBg : null;
  const expanded = !!s.gotoRingSettingsExpanded;
  return { size, bg, expanded };
}

/**
 * 更新悬浮圆环大小。校验失败抛 Error 让 message adapter 返回失败。
 * 接受任意数字,内部 clamp 到 [RING_MIN_PX, RING_MAX_PX] 并取整。
 */
async function updateGotoRingSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    throw new Error(`Invalid size: expected number, got ${typeof size}`);
  }
  const next = clampSize(size);
  const { settings } = await chrome.storage.local.get(['settings']);
  const nextSettings = { ...(settings || {}), gotoRingSize: next };
  await chrome.storage.local.set({ settings: nextSettings });
  return { size: next };
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
  const nextSettings = { ...(settings || {}), gotoRingBg: bg };
  await chrome.storage.local.set({ settings: nextSettings });
  return { bg };
}

/**
 * 切换 goto 管理圆环 ⚙ 面板的展开/收起状态。
 */
async function updateGotoRingSettingsExpanded(expanded) {
  const value = !!expanded;
  const { settings } = await chrome.storage.local.get(['settings']);
  const nextSettings = { ...(settings || {}), gotoRingSettingsExpanded: value };
  await chrome.storage.local.set({ settings: nextSettings });
  return { expanded: value };
}

/**
 * 把 size 直接成像素(返回的本来就是数字,保留接口兼容)。
 */
function getGotoRingSizePx(size) {
  return clampSize(size);
}

export {
  getGotoRingSettings,
  updateGotoRingSize,
  updateGotoRingBg,
  updateGotoRingSettingsExpanded,
  getGotoRingSizePx,
  // 暴露给测试/调试
  isValidBg,
  RING_MIN_PX,
  RING_MAX_PX,
  RING_DEFAULT_PX,
  LEGACY_ENUM_PX
};