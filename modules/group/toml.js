/**
 * toml.js - Group 域的 TOML 序列化 / 解析 + AI 提示词构建
 *
 * 用途:
 * - 把分组收藏(groups + tabs)序列化为标准 TOML,供快捷导出 / 给外部 AI 阅读
 * - 解析外部 AI 按约定生成的 TOML,合并导入为新的 group 收藏
 * - 构建多段提示词:L1 = TOML 领域数据结构标准;L2 = chrome.tabs API 实时获取的当前标签页参考
 *
 * 规约:本模块只处理文本与纯数据结构,不碰 chrome.storage(存储唯一入口是
 * background/group-model.js),也不直接发消息。
 *
 * 支持的 TOML 子集(也是 L1 提示词要求 AI 输出的格式):
 *   version = "1.0"                       # 顶层 key = value(字符串/布尔/整数)
 *   [[groups]]                            # 分组数组表
 *   name = "工作"
 *   color = "#45b7d1"
 *   visible = true
 *   goto = false
 *   [[groups.tabs]]                       # 嵌套标签数组表,归属最近一个 [[groups]]
 *   title = "MDN"
 *   url = "https://developer.mozilla.org/"
 * 字符串支持双引号基本字符串(含 \" \\ \n \t \r \b \f \uXXXX 转义)与单引号字面字符串;
 * # 注释(字符串外)、空行、CRLF 均可。
 */

const TOML_VERSION = '1.0';

/**
 * 把字符串编码为 TOML 基本字符串(basic string),含双引号与标准转义。
 * @param {string} value
 * @returns {string} 带双引号的 TOML 字符串字面量
 */
function tomlString(value) {
  const s = value === null || value === undefined ? '' : String(value);
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      default:
        // 其余 C0 控制字符用 \u00XX 转义,保证输出是合法 TOML
        if (code < 0x20) {
          out += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          out += ch;
        }
    }
  }
  return `"${out}"`;
}

/**
 * 把分组收藏序列化为 TOML 文本。
 * @param {Array<object>} groups - 分组数组(含 name/color/visible/goto/ns)
 * @param {Object<string, Array>} tabsMap - { [groupId]: tab[] }
 * @param {object} [opts]
 * @param {boolean} [opts.includeNs=true] - 是否导出 ns 字段(导入时仅在合法时生效)
 * @returns {string} TOML 文本
 */
function serializeGroupsToToml(groups, tabsMap, { includeNs = true } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const map = tabsMap && typeof tabsMap === 'object' ? tabsMap : {};
  const lines = [];
  lines.push('# TabBoard 分组收藏导出 (TOML)');
  lines.push(`# 导出时间: ${new Date().toISOString()}`);
  lines.push(`version = ${tomlString(TOML_VERSION)}`);
  lines.push('');

  list.forEach((group) => {
    if (!group || typeof group !== 'object') return;
    lines.push('[[groups]]');
    lines.push(`name = ${tomlString(group.name || '')}`);
    lines.push(`color = ${tomlString(group.color || '#45b7d1')}`);
    if (includeNs && typeof group.ns === 'string' && group.ns.length > 0) {
      lines.push(`ns = ${tomlString(group.ns)}`);
    }
    lines.push(`visible = ${group.visible !== false}`);
    lines.push(`goto = ${group.goto === true}`);

    const tabs = Array.isArray(map[group.id]) ? map[group.id] : [];
    tabs.forEach((tab) => {
      if (!tab || !tab.url) return;
      lines.push('');
      lines.push('[[groups.tabs]]');
      lines.push(`title = ${tomlString(tab.title || tab.url)}`);
      lines.push(`url = ${tomlString(tab.url)}`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * 去掉行内注释(# 必须在字符串外)。
 */
function stripComment(line) {
  let inBasic = false;
  let inLiteral = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inBasic) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inBasic = false;
    } else if (inLiteral) {
      if (ch === "'") inLiteral = false;
    } else if (ch === '"') {
      inBasic = true;
    } else if (ch === "'") {
      inLiteral = true;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * 解析 TOML 基本字符串内容(入参不含外层双引号),解码标准转义。
 */
function decodeBasicString(raw, lineNo) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') { out += ch; continue; }
    const esc = raw[++i];
    switch (esc) {
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case 'u':
      case 'U': {
        const len = esc === 'u' ? 4 : 8;
        const hex = raw.slice(i + 1, i + 1 + len);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) {
          throw new Error(`第 ${lineNo} 行:非法的 Unicode 转义 \\${esc}${hex}`);
        }
        out += String.fromCodePoint(parseInt(hex, 16));
        i += len;
        break;
      }
      default:
        throw new Error(`第 ${lineNo} 行:不支持的字符串转义 \\${esc}`);
    }
  }
  return out;
}

/**
 * 解析右侧值。支持:基本字符串 / 字面字符串 / 布尔 / 整数。
 */
function parseValue(raw, lineNo) {
  const v = raw.trim();
  if (v.length === 0) throw new Error(`第 ${lineNo} 行:缺少值`);
  if (v.startsWith('"')) {
    if (v.length < 2 || !v.endsWith('"')) {
      throw new Error(`第 ${lineNo} 行:双引号字符串未闭合`);
    }
    return decodeBasicString(v.slice(1, -1), lineNo);
  }
  if (v.startsWith("'")) {
    if (v.length < 2 || !v.endsWith("'")) {
      throw new Error(`第 ${lineNo} 行:单引号字符串未闭合`);
    }
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^[+-]?\d+$/.test(v)) return parseInt(v, 10);
  throw new Error(`第 ${lineNo} 行:不支持的值类型(仅支持双引号字符串、单引号字符串、true/false、整数): ${v}`);
}

/**
 * 解析表数组头 [[a.b]] 中的路径段。
 * 仅支持裸键(groups / tabs),保证错误信息对 AI 友好。
 */
function parseTableHeader(inner, lineNo) {
  const parts = inner.trim().split('.').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error(`第 ${lineNo} 行:空的表名`);
  for (const p of parts) {
    if (!/^[A-Za-z0-9_-]+$/.test(p)) {
      throw new Error(`第 ${lineNo} 行:不支持的表名 ${p}(仅允许 groups / groups.tabs)`);
    }
  }
  return parts;
}

/**
 * 解析分组收藏 TOML。
 * @param {string} text
 * @returns {{ version: string, groups: Array<{name:string,color:string,ns:string,visible:boolean|undefined,goto:boolean|undefined,tabs:Array<{title:string,url:string}>}>, warnings: string[] }}
 * @throws {Error} 语法错误 / 缺少分组 / 分组缺 name 时抛出(消息含行号)
 */
function parseGroupsToml(text) {
  if (typeof text !== 'string') throw new Error('TOML 内容必须是文本');
  const src = text.replace(/^\uFEFF/, '');
  const lines = src.split(/\r\n|\r|\n/);

  const meta = {};
  const groups = [];
  let currentGroup = null;
  let kvTarget = null; // 'meta' | 'group' | 'tab'
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]).trim();
    if (!line) continue;

    // 表数组头
    if (line.startsWith('[')) {
      if (!line.startsWith('[[') || !line.endsWith(']]')) {
        throw new Error(`第 ${lineNo} 行:仅支持数组表 [[groups]] / [[groups.tabs]]`);
      }
      const path = parseTableHeader(line.slice(2, -2), lineNo);
      if (path.length === 1 && path[0] === 'groups') {
        currentGroup = { name: '', color: '', ns: '', visible: undefined, goto: undefined, tabs: [] };
        groups.push(currentGroup);
        kvTarget = 'group';
        continue;
      }
      if (path.length === 2 && path[0] === 'groups' && path[1] === 'tabs') {
        if (!currentGroup) {
          throw new Error(`第 ${lineNo} 行:[[groups.tabs]] 必须出现在某个 [[groups]] 之后`);
        }
        const tab = { title: '', url: '' };
        currentGroup.tabs.push(tab);
        kvTarget = tab; // 后续 key=value 直接写入该 tab 对象
        continue;
      }
      throw new Error(`第 ${lineNo} 行:未知的表 ${path.join('.')}(仅允许 [[groups]] 与 [[groups.tabs]])`);
    }

    // key = value
    const eqIndex = findEquals(line);
    if (eqIndex === -1) {
      throw new Error(`第 ${lineNo} 行:无法识别的语法(应为 key = value 或 [[表]]): ${line}`);
    }
    const key = line.slice(0, eqIndex).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`第 ${lineNo} 行:非法的键名 ${key}`);
    }
    const value = parseValue(line.slice(eqIndex + 1), lineNo);

    if (kvTarget === null) {
      meta[key] = value; // 顶层元数据(version 等),导入时忽略
    } else if (kvTarget === 'group') {
      if (!['name', 'color', 'ns', 'visible', 'goto'].includes(key)) {
        warnings.push(`第 ${lineNo} 行:分组的未知字段 ${key} 已忽略`);
      } else {
        currentGroup[key] = value;
      }
    } else if (typeof kvTarget === 'object') {
      if (!['title', 'url', 'favicon'].includes(key)) {
        warnings.push(`第 ${lineNo} 行:标签的未知字段 ${key} 已忽略`);
      } else {
        kvTarget[key] = value;
      }
    }
  }

  if (groups.length === 0) {
    throw new Error('TOML 中没有找到任何 [[groups]] 分组');
  }

  // 结构校验与清洗
  const cleaned = [];
  groups.forEach((g, idx) => {
    const name = typeof g.name === 'string' ? g.name.trim() : '';
    if (!name) {
      throw new Error(`第 ${idx + 1} 个分组缺少非空的 name 字段`);
    }
    const tabs = [];
    g.tabs.forEach((t, j) => {
      const url = typeof t.url === 'string' ? t.url.trim() : '';
      if (!url) {
        warnings.push(`分组「${name}」第 ${j + 1} 个标签缺少 url,已忽略`);
        return;
      }
      const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : url;
      tabs.push({ title, url });
    });
    cleaned.push({
      name,
      color: typeof g.color === 'string' ? g.color.trim() : '',
      ns: typeof g.ns === 'string' ? g.ns.trim() : '',
      visible: typeof g.visible === 'boolean' ? g.visible : undefined,
      goto: typeof g.goto === 'boolean' ? g.goto : undefined,
      tabs
    });
  });

  return { version: meta.version || TOML_VERSION, groups: cleaned, warnings };
}

/**
 * 找到键值分隔符 = 的位置(跳过字符串内部的 =)。
 */
function findEquals(line) {
  let inBasic = false;
  let inLiteral = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inBasic) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inBasic = false;
    } else if (inLiteral) {
      if (ch === "'") inLiteral = false;
    } else if (ch === '"') {
      inBasic = true;
    } else if (ch === "'") {
      inLiteral = true;
    } else if (ch === '=') {
      return i;
    }
  }
  return -1;
}

// ===================== AI 多段提示词 =====================

/**
 * L1:TOML 标准领域数据结构说明(给任意外部 AI 的固定指令段)。
 */
const L1_PROMPT = `你是 TabBoard(浏览器标签页收藏管理 Chrome 扩展)的「收藏分组整理助手」。
我会给你一些资料,你需要输出符合下面 TOML 领域数据结构的文本,我将把它直接导入扩展,创建新的分组收藏。

【L1 · TOML 领域数据结构标准(必须严格遵守)】

1. 只输出 TOML 本体(放在一个 \`\`\`toml 代码块中),不要输出解释、寒暄或其它内容。
2. 顶层固定一行:version = "1.0"
3. 用 [[groups]] 定义一个分组(数组表),支持字段:
   - name(必填,字符串):分组名称,简洁准确,建议不超过 20 个字符
   - color(必填,字符串):只能从以下 10 个色值中选择一个
       #ff6b6b 红  #4ecdc4 青  #45b7d1 蓝  #f9ca24 黄  #6c5ce7 紫
       #a29bfe 淡紫  #fd79a8 粉  #00b894 绿  #e17055 橙  #74b9ff 天蓝
   - visible(可选,布尔):是否在看板显示,默认 true
   - goto(可选,布尔):是否在快捷圆环展示,默认 false
4. 在某个 [[groups]] 之后,用若干个 [[groups.tabs]] 定义归属它的收藏标签(嵌套数组表),字段:
   - title(必填,字符串):标签标题
   - url(必填,字符串):完整 URL,必须以 http:// 或 https:// 开头
5. TOML 语法要求:
   - 字符串一律用双引号;字符串内部的双引号写成 \\",换行写成 \\n,反斜杠写成 \\\\
   - 布尔只能写 true 或 false;每行一个 key = value;可以用 # 写注释
   - [[groups.tabs]] 必须紧跟其所属的 [[groups]];出现下一个 [[groups]] 即表示上一分组结束
6. 数据要求:
   - 按主题语义聚类分组,分组名要能概括内容;同一分组内 url 不得重复
   - 剔除空白页、登录页、错误页等没有收藏价值的 URL;不要臆造我没有提供的链接
   - 保留原始 URL,不要删减查询参数之外的路径信息

完整示例:

version = "1.0"

[[groups]]
name = "前端学习"
color = "#45b7d1"
visible = true
goto = false

[[groups.tabs]]
title = "MDN Web Docs"
url = "https://developer.mozilla.org/"

[[groups.tabs]]
title = "Can I use"
url = "https://caniuse.com/"

[[groups]]
name = "常用工具"
color = "#00b894"

[[groups.tabs]]
title = "GitHub"
url = "https://github.com/"`;

/**
 * goto 圆环场景附加段。
 * 依据 background/group-model.js getGotoMenuData():圆环每个分组只取前 6 个 tab,
 * 因此提示词必须硬性要求每组 ≤ 6,并显式 goto = true。
 */
const GOTO_RING_PROMPT = `【场景模式 · goto 快捷圆环(本次整理的是圆环收藏)】
本次导入的分组将用于扩展的 goto 快捷圆环(浏览网页时悬浮在页面上的快捷入口)。
在上面 L1 通用规则之上,必须额外严格遵守:
1. 每个 [[groups]] 下的 [[groups.tabs]] 数量必须 ≤ 6 个。
   圆环对每个分组只展示前 6 个标签,第 7 个及以后永远不会出现在圆环上。
2. 如果某一主题的链接超过 6 个:请拆分成多个分组(例如「文档-参考」「文档-工具」),
   或只保留最高频、最有入口价值的 6 个,剔除深层详情页 / 一次性页面。
3. 每个分组都必须显式写一行 goto = true,否则该分组不会出现在圆环上。
4. 分组总数建议不超过 8 个(圆环一屏容量有限);分组名尽量短(建议 ≤ 8 个字符),
   圆环空间只适合简短标题。
5. 每个分组内的标签按重要性从高到低排列(圆环按顺序只取前 6 个)。`;

/**
 * 构建多段 AI 提示词。
 * @param {object} opts
 * @param {null|Array<{title:string,url:string}>} opts.tabs
 *        - null:用户未勾选 L2,仅输出 L1(用户随后自行补充文字需求)
 *        - 数组:追加 L2 段,列出 chrome.tabs API 获取到的当前浏览器标签页
 * @param {boolean} [opts.gotoRing=false]
 *        - true:追加 goto 圆环场景段,要求每组 ≤ 6 个标签且 goto = true
 * @returns {string}
 */
function buildAiPrompt({ tabs = null, gotoRing = false } = {}) {
  const parts = [L1_PROMPT, ''];
  if (gotoRing) {
    parts.push(GOTO_RING_PROMPT, '');
  }
  if (Array.isArray(tabs) && tabs.length > 0) {
    parts.push('【L2 · 当前浏览器标签页参考(通过 chrome.tabs 官方 API 实时获取)】');
    parts.push('以下是我浏览器中当前打开的标签页,请以此为事实依据:理解我正在进行的任务,');
    parts.push('把这些页面按主题归纳为合适的分组并命名、选色;过滤无关、重复或临时性页面;');
    parts.push('不要编造列表之外的 URL。');
    parts.push('');
    tabs.forEach((t, i) => {
      parts.push(`${i + 1}. ${t.title}`);
      parts.push(`   ${t.url}`);
    });
    parts.push('');
    parts.push('请基于以上 L2 标签页,直接输出 TOML。');
  } else {
    parts.push('（本次未附带 L2 浏览器标签页数据。）');
    parts.push('我会在下面用文字描述我的收藏整理需求,请据此直接输出 TOML:');
  }
  if (gotoRing) {
    parts.push('');
    parts.push('再次提醒:这是 goto 圆环收藏 —— 每个分组 goto = true,且每个分组标签数 ≤ 6。');
  }
  return parts.join('\n');
}

export {
  serializeGroupsToToml,
  parseGroupsToml,
  buildAiPrompt,
  tomlString
};
