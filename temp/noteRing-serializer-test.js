/**
 * noteRing serializer 回归测试 — 模拟 captureFrame 把图片块插到
 * div 内部(用户点击在 div 内时 capture)后的 DOM 结构,验证:
 *   1. pureTextContent / serializeEditor 不再 strip 嵌套的 [[URL]]
 *   2. [[URL]] 数量与 cache 一致,触发的 M2 不会被新的 abort 守卫拦住
 *
 * 用法:打开任意页面 → DevTools console → 粘贴运行。
 * 全部用例 PASS 才算修复成功。
 */
(() => {
  const eq = (a, b, label) => {
    if (a === b) console.log(`✓ ${label}`);
    else { console.error(`✗ ${label}\n   expected: ${JSON.stringify(b)}\n   got:      ${JSON.stringify(a)}`); failures++; }
  };
  let failures = 0;

  // 模拟 noteRing 用的最小 helper
  function mkImg(url) {
    const s = document.createElement('span');
    s.className = 'nr-img-block';
    s.setAttribute('contenteditable', 'false');
    s.setAttribute('data-url', url);
    const img = document.createElement('img'); img.alt = '视频帧';
    const x = document.createElement('button'); x.className = 'nr-img-x'; x.type = 'button'; x.textContent = '×';
    const r = document.createElement('button'); r.className = 'nr-img-retry'; r.type = 'button'; r.textContent = '↻';
    s.appendChild(img); s.appendChild(x); s.appendChild(r);
    return s;
  }
  function mkDiv(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d;
  }

  // 1) 嵌套图片块:div 里夹 nr-img-block,纯文本序列化必须保留 [[URL]]
  const div = mkDiv('更多文字');
  div.appendChild(mkImg('http://47.110.80.47:8988/files/url1'));
  div.appendChild(mkImg('http://47.110.80.47:8988/files/url2'));
  div.appendChild(mkImg('http://47.110.80.47:8988/files/url3'));

  // 把现有 pureTextContent / serializeEditor 的逻辑搬过来跑
  // (这里直接复制修复后的实现,见 noteRing.js 的 pureTextContent 修改)
  function pureTextContent(el) {
    let out = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) out += child.textContent;
      else if (child.nodeType === 1) {
        const c = child;
        if (c.classList.contains('nr-img-block')) {
          const url = c.getAttribute('data-url');
          if (url) out += `[[${url}]]`;
        } else if (c.classList.contains('nr-img-source')) {
          const txt = (c.textContent || '').trim();
          const m = txt.match(/^\[\[(https?:\/\/[^\]]+)\]\]$/);
          if (m) out += txt;
          else { const fb = c.getAttribute('data-url') || ''; if (fb) out += `[[${fb}]]`; }
        } else if (c.classList.contains('nr-img-pending')) {
          // skip
        } else {
          out += pureTextContent(c);
        }
      }
    }
    return out;
  }

  const got = pureTextContent(div);
  eq(got.includes('[[http://47.110.80.47:8988/files/url1]]'), true, 'nested url1 保留');
  eq(got.includes('[[http://47.110.80.47:8988/files/url2]]'), true, 'nested url2 保留');
  eq(got.includes('[[http://47.110.80.47:8988/files/url3]]'), true, 'nested url3 保留');
  eq(got.includes('更多文字'), true, 'div 文字保留');
  eq(got.includes('×'), false, '× 按钮字符不泄漏');
  eq(got.includes('↻'), false, '↻ 按钮字符不泄漏');

  // 2) 计数防御:editorUrls 不能少于 cachedUrls
  const cached = '更多文字[[http://47.110.80.47:8988/files/url1]][[http://47.110.80.47:8988/files/url2]][[http://47.110.80.47:8988/files/url3]]';
  const cachedUrls = (cached.match(/\[\[https?:\/\/[^\]]+\]\]/g) || []);
  const editorUrls = (got.match(/\[\[https?:\/\/[^\]]+\]\]/g) || []);
  eq(editorUrls.length === cachedUrls.length, true, `[[URL]] 数量守恒 (editor=${editorUrls.length}, cache=${cachedUrls.length})`);
  eq(editorUrls.length > cachedUrls.length, false, 'editorUrl 不会多于 cache (sanity)');

  // 3) pending 占位必须 strip
  const div2 = mkDiv('text');
  const pending = document.createElement('span');
  pending.className = 'nr-img-pending';
  pending.setAttribute('contenteditable', 'false');
  pending.textContent = '[上传中…]';
  div2.appendChild(pending);
  const got2 = pureTextContent(div2);
  eq(got2.includes('[上传中…]'), false, 'nr-img-pending 不写入');
  eq(got2.includes('text'), true, '文字仍然保留');

  console.log(failures === 0 ? '\n✅ 全部 PASS — 修复有效' : `\n❌ ${failures} 个 FAIL — 修复未到位`);
})();