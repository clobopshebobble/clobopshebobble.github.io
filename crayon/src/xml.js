// xml.js — a tiny dependency-free XML reader. The Deluxe data files are plain, well-formed,
// attribute-and-text XML with no namespaces, entities or CDATA, so a 60-line parser that runs
// identically in the browser and in Node is simpler than juggling DOMParser vs. a Node package.
//
// Element shape: { name, attrs: {k: v}, children: [el], text: "" }

export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += src.slice(i); break; }
    if (lt > i) top.text += src.slice(i, lt);
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? n : e + 2; continue; }
    const gt = tagEnd(src, lt);
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const el = { name, attrs: {}, children: [], text: '' };
    if (sp >= 0) {
      const re = /([^\s=]+)\s*=\s*"([^"]*)"/g;
      let m;
      while ((m = re.exec(body.slice(sp)))) el.attrs[m[1]] = m[2];
    }
    top.children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root.children[0] || root;
}

function tagEnd(src, from) {
  let q = null;
  for (let j = from + 1; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '>') return j;
  }
  return src.length;
}

export const child = (el, name) => el && el.children.find((c) => c.name === name);
export const children = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
export const text = (el) => (el ? el.text.trim() : '');
export function num(el, name, def = 0) {
  const c = child(el, name);
  if (!c) return def;
  const t = text(c);
  if (t === '') return def;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : def;
}
export function attrNum(el, name, def = 0) {
  if (!el || el.attrs[name] === undefined) return def;
  const v = parseFloat(el.attrs[name]);
  return Number.isFinite(v) ? v : def;
}
