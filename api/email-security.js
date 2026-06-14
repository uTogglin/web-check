import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { parseTarget } from './_common/parse-target.js';

const TXT_TYPE = 16;

// Resolve TXT records via DNS-over-HTTPS so this works without a local resolver
// and on edge runtimes. Each TXT record is reassembled from its quoted chunks.
const queryTxt = async (name) => {
  const res = await httpGet('https://dns.google/resolve', {
    params: { name, type: 'TXT' },
    headers: { Accept: 'application/dns-json' },
  });
  const answers = res.data?.Answer || [];
  return answers
    .filter((a) => a.type === TXT_TYPE)
    .map((a) => {
      const chunks = a.data.match(/"((?:[^"\\]|\\.)*)"/g);
      return chunks ? chunks.map((c) => c.slice(1, -1)).join('') : a.data;
    });
};

const safeTxt = (name) => queryTxt(name).catch(() => []);

// --- SPF -------------------------------------------------------------------
const gradeSpf = (txtRecords) => {
  const spfRecords = txtRecords.filter((r) => /^v=spf1\b/i.test(r));
  if (spfRecords.length === 0) {
    return { present: false, score: 0, status: 'fail', summary: 'No SPF record found.' };
  }
  if (spfRecords.length > 1) {
    return {
      present: true,
      score: 1,
      status: 'fail',
      record: spfRecords.join(' | '),
      summary: 'Multiple SPF records found — this is invalid and SPF will be ignored.',
    };
  }
  const record = spfRecords[0];
  const all = record.match(/([-~?+])all\b/i)?.[1] || null;
  const qualifier = { '-': 'hardfail', '~': 'softfail', '?': 'neutral', '+': 'pass' }[all] || null;
  let score = 2;
  let status = 'warn';
  let summary = 'SPF present but has no explicit `all` mechanism (defaults to neutral).';
  if (qualifier === 'hardfail') {
    score = 5;
    status = 'pass';
    summary = 'SPF ends with `-all` (hardfail) — unauthorised senders are rejected.';
  } else if (qualifier === 'softfail') {
    score = 4;
    status = 'pass';
    summary = 'SPF ends with `~all` (softfail) — unauthorised mail is accepted but flagged.';
  } else if (qualifier === 'neutral') {
    score = 2;
    summary = 'SPF ends with `?all` (neutral) — provides little protection.';
  } else if (qualifier === 'pass') {
    score = 1;
    status = 'fail';
    summary = 'SPF ends with `+all` — this authorises ANY sender and is dangerous.';
  }
  return { present: true, score, status, record, qualifier, summary };
};

// --- DMARC -----------------------------------------------------------------
const parseTags = (record) =>
  record.split(';').reduce((acc, part) => {
    const [k, v] = part.split('=').map((s) => (s || '').trim());
    if (k) acc[k.toLowerCase()] = (v || '').toLowerCase();
    return acc;
  }, {});

const gradeDmarc = (txtRecords) => {
  const record = txtRecords.find((r) => /^v=dmarc1\b/i.test(r));
  if (!record) {
    return { present: false, score: 0, status: 'fail', summary: 'No DMARC record found.' };
  }
  const tags = parseTags(record);
  const policy = tags.p || 'none';
  const pct = tags.pct ? parseInt(tags.pct, 10) : 100;
  const hasReporting = !!tags.rua;

  let score = 2;
  let status = 'warn';
  let summary = 'DMARC policy is `p=none` — monitoring only, no enforcement.';
  if (policy === 'reject') {
    score = 5;
    status = 'pass';
    summary = 'DMARC policy is `p=reject` — spoofed mail is rejected. Strongest setting.';
  } else if (policy === 'quarantine') {
    score = 4;
    status = 'pass';
    summary = 'DMARC policy is `p=quarantine` — spoofed mail is sent to spam.';
  }
  // Partial enforcement weakens an otherwise-strong policy
  if (policy !== 'none' && pct < 100) {
    score = Math.max(2, score - 1);
    status = 'warn';
    summary += ` Only ${pct}% of mail is subject to the policy (pct=${pct}).`;
  }
  if (!hasReporting) {
    summary += ' No aggregate reporting address (rua) — you are blind to spoofing attempts.';
  }
  return { present: true, score, status, record, policy, pct, hasReporting, summary };
};

// --- DKIM ------------------------------------------------------------------
const DKIM_SELECTORS = [
  'default',
  'google',
  'selector1',
  'selector2',
  'k1',
  'k2',
  's1',
  's2',
  'dkim',
  'mail',
  'mandrill',
  'mxvault',
];

const gradeDkim = async (domain) => {
  const checks = DKIM_SELECTORS.map((s) =>
    safeTxt(`${s}._domainkey.${domain}`).then((records) => {
      if (!records.length) return null;
      const txt = records[0] || '';
      if (/p=\s*(;|$)/.test(txt)) return null; // revoked key (empty p=)
      return s;
    }),
  );
  const found = (await Promise.all(checks)).filter(Boolean);
  if (found.length === 0) {
    return {
      present: false,
      score: 1,
      status: 'warn',
      selectors: [],
      summary: 'No DKIM keys found at common selectors (a custom selector may still exist).',
    };
  }
  return {
    present: true,
    score: 5,
    status: 'pass',
    selectors: found,
    summary: `DKIM is configured (selectors: ${found.join(', ')}).`,
  };
};

// --- Overall ---------------------------------------------------------------
// Weighted toward DMARC + SPF, which actually stop spoofing
const WEIGHTS = { spf: 0.35, dmarc: 0.45, dkim: 0.2 };
const toGrade = (pct) => {
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 40) return 'D';
  if (pct >= 20) return 'E';
  return 'F';
};

const emailSecurityHandler = async (url) => {
  const { hostname: domain } = parseTarget(url);
  const [rootTxt, dmarcTxt, dkim] = await Promise.all([
    safeTxt(domain),
    safeTxt(`_dmarc.${domain}`),
    gradeDkim(domain),
  ]);

  const spf = gradeSpf(rootTxt);
  const dmarc = gradeDmarc(dmarcTxt);

  const weighted =
    (spf.score / 5) * WEIGHTS.spf +
    (dmarc.score / 5) * WEIGHTS.dmarc +
    (dkim.score / 5) * WEIGHTS.dkim;
  const scorePct = Math.round(weighted * 100);

  return {
    domain,
    grade: toGrade(scorePct),
    scorePct,
    spf,
    dmarc,
    dkim,
  };
};

export const handler = middleware(emailSecurityHandler);
export default handler;
