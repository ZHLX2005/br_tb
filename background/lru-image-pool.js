/**
 * LruImagePool — 图片 LRU 缓存池
 *
 * 设计目标:
 * - SW 内存级别缓存,所有 tab / content script 共享
 * - 上限保护:同时按"项数"和"总字节数"双重驱逐,防内存撑爆
 * - MV3 SW 30s 空闲会被 Chrome 自动杀掉 → 池自动归零,无持久化泄漏
 * - 单张 2MB 上限:超大的图(罕见)不缓存,避免大图独占池
 * - 命中 → touch(移到末尾);未命中 → fetch 完写回
 *
 * 阈值:
 * - MAX_ITEMS=50:单 tab 可视图片数远超这范围,日常 10-30 张
 * - MAX_BYTES_PER_ITEM=2MB:B 站 1080p 视频帧平均 1.2MB,留余量
 * - MAX_TOTAL_BYTES=20MB:Chrome 单 extension SW 内存预算 ~50-100MB,
 *   20MB 给池留余量给其他模块(notes/upload/timeline 等)
 *
 * 统计:
 *   stats() → { items, bytes, hits, misses, evictions } 让 popup 显示
 *   observe() 注册回调,set/evict 触发(给 UI 实时刷新用)
 */

export class LruImagePool {
  constructor(opts = {}) {
    this.maxItems = opts.maxItems ?? 50;
    this.maxBytesPerItem = opts.maxBytesPerItem ?? 2 * 1024 * 1024;
    this.maxTotalBytes = opts.maxTotalBytes ?? 20 * 1024 * 1024;
    // Map 顺序:最久未访问 → 最新访问(JS Map 是有顺序的)
    this.map = new Map();
    this.bytes = 0;
    // 命中统计,给 popup 显示命中率(不强依赖,纯观测)
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this._observers = [];
  }

  /**
   * 查询:命中并 LRU touch。返回 null 表示未命中。
   */
  get(url) {
    const it = this.map.get(url);
    if (!it) {
      this.misses++;
      this._notify();
      return null;
    }
    // 命中 → delete + set 移到末尾(最新访问)
    this.map.delete(url);
    this.map.set(url, it);
    this.hits++;
    this._notify();
    return it.blob;
  }

  /**
   * 写入:若超过单张上限不入池;若池满则驱逐最旧
   */
  set(url, blob) {
    if (!url || !blob || blob.size == null) return;
    if (blob.size > this.maxBytesPerItem) return;  // 大图不入池

    // 已存在:先扣除旧字节再覆盖
    if (this.map.has(url)) {
      const old = this.map.get(url);
      this.bytes -= old.blob.size;
      this.map.delete(url);
    }

    this.bytes += blob.size;
    this.map.set(url, { blob, createdAt: Date.now() });

    // 双重驱逐:项数 或 总字节超限 → 删最久未访问
    while (
      this.map.size > this.maxItems ||
      this.bytes > this.maxTotalBytes
    ) {
      const oldestKey = this.map.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.map.get(oldestKey);
      this.bytes -= oldest.blob.size;
      this.map.delete(oldestKey);
      this.evictions++;
    }
    this._notify();
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
    this._notify();
  }

  stats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) : 0;
    return {
      items: this.map.size,
      maxItems: this.maxItems,
      bytes: this.bytes,
      maxTotalBytes: this.maxTotalBytes,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      evictions: this.evictions
    };
  }

  observe(cb) {
    this._observers.push(cb);
    return () => {
      this._observers = this._observers.filter((x) => x !== cb);
    };
  }

  _notify() {
    const s = this.stats();
    for (const cb of this._observers) {
      try { cb(s); } catch (_) { /* observer error swallowed */ }
    }
  }
}

// 单例:所有 SW 调用共享同一个池
export const imagePool = new LruImagePool();
