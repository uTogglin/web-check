// Browserless technology detection. Matches Wappalyzer's bundled fingerprint
// database against the page's raw HTML, response headers, cookies, meta tags,
// script srcs and URL. No Chromium required, so this works everywhere and is
// used as the reliable baseline (the browser-based Wappalyzer run, when it
// succeeds, is merged on top for richer JS-based detection).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// --- DB loading (cached at module scope) -----------------------------------

let DB = null;

// Split a Wappalyzer pattern ("regex\;version:\1\;confidence:50") into its
// regex plus version/confidence modifiers, pre-compiling the RegExp once.
const compilePattern = (pattern) => {
  if (typeof pattern !== 'string') pattern = String(pattern ?? '');
  const [value, ...mods] = pattern.split('\\;');
  let version = '';
  let confidence = 100;
  for (const mod of mods) {
    const idx = mod.indexOf(':');
    const key = idx === -1 ? mod : mod.slice(0, idx);
    const val = idx === -1 ? '' : mod.slice(idx + 1);
    if (key === 'version') version = val;
    else if (key === 'confidence') confidence = parseInt(val, 10) || 0;
  }
  let regex = null;
  try {
    regex = new RegExp(value || '', 'i');
  } catch {
    regex = null; // skip fingerprints with regexes Node's engine rejects
  }
  return regex ? { regex, version, confidence } : null;
};

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// Normalise a keyed pattern object (headers/cookies/meta) into {key, ...pattern}
const compileKeyed = (obj) => {
  const out = [];
  for (const [key, raw] of Object.entries(obj || {})) {
    for (const pat of toArray(raw)) {
      const c = compilePattern(pat);
      if (c) out.push({ key: key.toLowerCase(), ...c });
    }
  }
  return out;
};

const compileList = (raw) => toArray(raw).map(compilePattern).filter(Boolean);

const loadDb = () => {
  if (DB) return DB;
  const categoriesPath = require.resolve('wappalyzer/categories.json');
  const techDir = join(dirname(categoriesPath), 'technologies');

  const categories = JSON.parse(readFileSync(categoriesPath, 'utf8'));
  const catName = (id) => categories[id]?.name || String(id);

  const technologies = [];
  for (const file of readdirSync(techDir)) {
    if (!file.endsWith('.json')) continue;
    let group;
    try {
      group = JSON.parse(readFileSync(join(techDir, file), 'utf8'));
    } catch {
      continue; // skip .gitkeep / malformed shards
    }
    for (const [name, fp] of Object.entries(group)) {
      technologies.push({
        name,
        icon: fp.icon || '',
        website: fp.website || '',
        description: fp.description || '',
        categories: toArray(fp.cats).map((id) => ({ name: catName(id) })),
        implies: toArray(fp.implies),
        headers: compileKeyed(fp.headers),
        cookies: compileKeyed(fp.cookies),
        meta: compileKeyed(fp.meta),
        html: compileList(fp.html),
        scriptSrc: compileList(fp.scriptSrc),
        url: compileList(fp.url),
      });
    }
  }
  DB = { technologies, byName: new Map(technologies.map((t) => [t.name, t])) };
  return DB;
};

// --- Matching helpers ------------------------------------------------------

// Resolve a version template ("\1", "\1?a:b") against a regex match
const resolveVersion = (template, match) => {
  if (!template) return '';
  return template
    .replace(/\\(\d)\?([^:]*):([^\\]*)/g, (_, i, a, b) => (match[+i] ? a : b))
    .replace(/\\(\d)/g, (_, i) => match[+i] || '')
    .trim();
};

// Test one compiled pattern against a string; returns {confidence, version} or null
const testPattern = (pat, value) => {
  if (value == null) return null;
  const m = pat.regex.exec(String(value));
  if (!m) return null;
  return { confidence: pat.confidence, version: resolveVersion(pat.version, m) };
};

// Build the lowercase-keyed signal maps we can inspect without a browser
const buildSignals = ({ url, html, headers, cookies }) => {
  const headerMap = {};
  for (const [k, v] of Object.entries(headers || {})) {
    headerMap[k.toLowerCase()] = Array.isArray(v) ? v.join(' ') : v;
  }

  // Meta tags: name|property -> content
  const metaMap = {};
  const body = (html || '').slice(0, 3_000_000); // guard against huge pages
  const metaRe = /<meta[^>]+>/gi;
  let mt;
  while ((mt = metaRe.exec(body))) {
    const tag = mt[0];
    const nameM = /(?:name|property|http-equiv)\s*=\s*["']?([^"'>\s]+)/i.exec(tag);
    const contentM = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (nameM && contentM) metaMap[nameM[1].toLowerCase()] = contentM[1];
  }

  // Script srcs
  const scripts = [];
  const scriptRe = /<script[^>]+src\s*=\s*["']?([^"'\s>]+)/gi;
  let st;
  while ((st = scriptRe.exec(body))) scripts.push(st[1]);

  return { url: url || '', html: body, headers: headerMap, cookies: cookies || {}, metaMap, scripts };
};

// --- Detection -------------------------------------------------------------

const addHit = (hits, name, confidence, version) => {
  const cur = hits.get(name) || { confidence: 0, version: '' };
  cur.confidence = Math.min(100, cur.confidence + confidence);
  if (version && !cur.version) cur.version = version;
  hits.set(name, cur);
};

const matchTech = (tech, sig, hits) => {
  let matched = false;
  const consider = (res) => {
    if (!res) return;
    matched = true;
    addHit(hits, tech.name, res.confidence, res.version);
  };

  for (const p of tech.headers) consider(testPattern(p, sig.headers[p.key]));
  for (const p of tech.cookies) {
    // cookie key may itself be a pattern; check every response cookie name
    for (const [cname, cval] of Object.entries(sig.cookies)) {
      if (cname.toLowerCase() === p.key || new RegExp(p.key, 'i').test(cname)) {
        consider(testPattern(p, cval || cname));
      }
    }
  }
  for (const p of tech.meta) consider(testPattern(p, sig.metaMap[p.key]));
  for (const p of tech.html) consider(testPattern(p, sig.html));
  for (const p of tech.url) consider(testPattern(p, sig.url));
  for (const p of tech.scriptSrc) {
    for (const s of sig.scripts) consider(testPattern(p, s));
  }
  return matched;
};

// Pull in technologies implied by the ones already detected (e.g. WordPress -> PHP)
const applyImplies = (hits, byName) => {
  const queue = [...hits.keys()];
  while (queue.length) {
    const tech = byName.get(queue.shift());
    if (!tech) continue;
    for (const imp of tech.implies) {
      const [name, ...mods] = String(imp).split('\\;');
      if (hits.has(name)) continue;
      let confidence = 100;
      for (const mod of mods) if (mod.startsWith('confidence:')) confidence = parseInt(mod.slice(11), 10) || 100;
      addHit(hits, name, confidence, '');
      queue.push(name);
    }
  }
};

// Detect technologies from already-fetched page data. Returns the same shape
// the frontend expects: [{ name, version, confidence, categories:[{name}], icon, website, description }]
export const detectTech = ({ url, html, headers, cookies }) => {
  const { technologies, byName } = loadDb();
  const sig = buildSignals({ url, html, headers, cookies });

  const hits = new Map();
  for (const tech of technologies) matchTech(tech, sig, hits);
  applyImplies(hits, byName);

  const out = [];
  for (const [name, hit] of hits) {
    const tech = byName.get(name);
    if (!tech) continue;
    out.push({
      name,
      version: hit.version || '',
      confidence: hit.confidence,
      categories: tech.categories,
      icon: tech.icon,
      website: tech.website,
      description: tech.description,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
};

// Merge two technology lists (dedupe by name, keep the richest entry)
export const mergeTech = (primary, secondary) => {
  const byName = new Map();
  const put = (t) => {
    if (!t?.name) return;
    const existing = byName.get(t.name);
    if (!existing) {
      byName.set(t.name, { ...t, categories: t.categories || [] });
      return;
    }
    existing.confidence = Math.min(100, Math.max(existing.confidence || 0, t.confidence || 0));
    if (!existing.version && t.version) existing.version = t.version;
    if (!existing.description && t.description) existing.description = t.description;
    if (!existing.icon && t.icon) existing.icon = t.icon;
    if (!existing.website && t.website) existing.website = t.website;
    if ((!existing.categories || !existing.categories.length) && t.categories?.length) {
      existing.categories = t.categories;
    }
  };
  for (const t of primary || []) put(t);
  for (const t of secondary || []) put(t);
  return [...byName.values()].sort(
    (a, b) => (b.confidence || 0) - (a.confidence || 0) || a.name.localeCompare(b.name),
  );
};

// Normalise a Wappalyzer browser result's technologies to our shape
export const normalizeWappalyzer = (technologies = []) =>
  technologies.map((t) => ({
    name: t.name,
    version: t.version || '',
    confidence: typeof t.confidence === 'number' ? t.confidence : 100,
    categories: (t.categories || []).map((c) => ({ name: c.name })),
    icon: t.icon || '',
    website: t.website || '',
    description: t.description || '',
  }));
