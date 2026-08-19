/**
 * ThumbService — SW 侧的图片缩略图生成 + 磁盘级持久缓存
 *
 * 设计要点:
 * 1. 全图解码发生在 SW 进程(OffscreenCanvas + createImageBitmap),
 *    content script 渲染进程永远不解码全图 → 避免页面里 8.3MB 位图驻留。
 * 2. CacheStorage('nr-thumbs') 持久,跨会话复用。修复原有 LRU 池被
 *    MV3 SW 30s 空闲杀掉 → 归零的问题(lru-image-pool.js 注释自承)。
 * 3. 缩略图规格:最长边 640,WebP q0.75(60-80KB/张)。失败回退 JPEG。
 * 4. 同 url 并发去重:同一时刻只 fetch 一次,共用一个 Promise。
 * 5. CacheStorage 存裸 blob(无 base64 膨胀),通过 Response 包装写入。
 */
const CACHE_NAME = 'nr-thumbs';
const DEFAULT_MAX_DIM = 640;
const WEBP_QUALITY = 0.75;
const FALLBACK_TYPE = 'image/jpeg';
const FALLBACK_QUALITY = 0.75;

const _inflight = new Map(); // url → Promise<thumbBlob|null>

async function openCache() {
  return caches.open(CACHE_NAME);
}

function fitDims(w, h) {
  const scale = Math.min(DEFAULT_MAX_DIM / w, 1);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * 把全图 blob 缩到 DEFAULT_MAX_DIM 以内,转 WebP(失败回退 JPEG)。
 * 自动释放 ImageBitmap。
 */
async function makeThumbBlob(fullBlob) {
  const bitmap = await createImageBitmap(fullBlob);
  try {
    const { w, h } = fitDims(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    try {
      return await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    } catch (_) {
      return await canvas.convertToBlob({ type: FALLBACK_TYPE, quality: FALLBACK_QUALITY });
    }
  } finally {
    bitmap.close();
  }
}

async function fetchGenerateAndCache(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const fullBlob = await r.blob();
  const thumbBlob = await makeThumbBlob(fullBlob);
  const cache = await openCache();
  await cache.put(url, new Response(thumbBlob, {
    headers: { 'Content-Type': thumbBlob.type || 'image/webp' }
  }));
  return thumbBlob;
}

/**
 * 命中 → 返回缩略图 blob;miss → fetch + 生成 + 缓存。
 * 失败(null)由调用方决定如何降级(留骨架 / 兜底代理)。
 */
export async function getOrMakeThumb(url) {
  if (!url) return null;
  // CacheStorage 命中
  try {
    const cache = await openCache();
    const hit = await cache.match(url);
    if (hit) return await hit.blob();
  } catch (_) {}
  // miss + 并发去重
  let p = _inflight.get(url);
  if (p) return p;
  p = (async () => {
    try {
      return await fetchGenerateAndCache(url);
    } catch (err) {
      console.warn('[thumb-service] makeThumb failed:', url, err.message);
      return null;
    } finally {
      _inflight.delete(url);
    }
  })();
  _inflight.set(url, p);
  return p;
}

/**
 * 写入一张已生成的缩略图(截帧 / 粘贴热路径:CS canvas 缩略图免费,
 * 推过来缓存,免冷打开时重复 fetch 全图)。thumbDataUrl 是 dataURL 字符串。
 */
export async function putThumbFromDataUrl(url, thumbDataUrl) {
  if (!url || !thumbDataUrl) return false;
  try {
    const blob = await (await fetch(thumbDataUrl)).blob();
    const cache = await openCache();
    await cache.put(url, new Response(blob, {
      headers: { 'Content-Type': blob.type || 'image/webp' }
    }));
    return true;
  } catch (err) {
    console.warn('[thumb-service] putThumb failed:', url, err.message);
    return false;
  }
}

/**
 * 调试用:当前缓存条目数。
 */
export async function stats() {
  try {
    const cache = await openCache();
    const keys = await cache.keys();
    return { count: keys.length };
  } catch (_) {
    return { count: 0 };
  }
}