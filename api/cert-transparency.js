import psl from 'psl';
import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { parseTarget } from './_common/parse-target.js';
import { upstreamError } from './_common/upstream.js';

const MAX_RECENT = 25; // How many recent certs to return in detail
const RECENT_WINDOW_DAYS = 90; // "Recently issued" threshold

// Reduce a hostname to its registrable domain so we cover the whole zone
const baseDomain = (host) => psl.parse(host)?.domain || host;
const isIpAddress = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

// crt.sh puts the CA in an X.500 string like "C=US, O=Let's Encrypt, CN=R3"
export const issuerOrg = (issuerName) => {
  if (typeof issuerName !== 'string') return 'Unknown';
  const org = issuerName.match(/O\s*=\s*("([^"]+)"|([^,]+))/);
  if (org) return (org[2] || org[3] || '').trim();
  const cn = issuerName.match(/CN\s*=\s*("([^"]+)"|([^,]+))/);
  return cn ? (cn[2] || cn[3] || '').trim() : 'Unknown';
};

// crt.sh timestamps lack a timezone; treat them as UTC for stable parsing
const toTime = (value) => {
  if (!value) return NaN;
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  return Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
};

export const summarise = (rows, nowMs) => {
  const recentCutoff = nowMs - RECENT_WINDOW_DAYS * 86400000;
  const issuerCounts = {};
  let recentlyIssued = 0;
  let currentlyValid = 0;

  const certs = rows.map((row) => {
    const issuer = issuerOrg(row.issuer_name);
    issuerCounts[issuer] = (issuerCounts[issuer] || 0) + 1;

    const loggedAt = toTime(row.entry_timestamp);
    const notBefore = toTime(row.not_before);
    const notAfter = toTime(row.not_after);
    if (!Number.isNaN(loggedAt) && loggedAt >= recentCutoff) recentlyIssued += 1;
    if (!Number.isNaN(notAfter) && notAfter >= nowMs && notBefore <= nowMs) currentlyValid += 1;

    return {
      id: row.id,
      commonName: row.common_name || null,
      issuer,
      notBefore: row.not_before || null,
      notAfter: row.not_after || null,
      loggedAt: row.entry_timestamp || null,
      serial: row.serial_number || null,
      sortKey: Number.isNaN(loggedAt) ? 0 : loggedAt,
    };
  });

  certs.sort((a, b) => b.sortKey - a.sortKey);

  const issuers = Object.entries(issuerCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalCerts: rows.length,
    uniqueIssuers: issuers.length,
    currentlyValid,
    recentlyIssued,
    recentWindowDays: RECENT_WINDOW_DAYS,
    issuers,
    recentCerts: certs.slice(0, MAX_RECENT).map(({ sortKey, ...rest }) => rest),
    source: 'crt.sh',
  };
};

const certTransparencyHandler = async (url, _req, _ctx, now = Date.now()) => {
  const { hostname } = parseTarget(url);
  if (isIpAddress(hostname)) {
    return { skipped: 'Certificate Transparency only applies to domain names' };
  }
  const domain = baseDomain(hostname);
  if (!domain || !domain.includes('.')) {
    return { skipped: 'Could not resolve a registrable domain' };
  }
  try {
    const res = await httpGet('https://crt.sh/', {
      params: { q: domain, output: 'json', exclude: 'expired' },
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(res.data)) {
      return { error: 'Certificate Transparency lookup returned unexpected data, please retry' };
    }
    if (!res.data.length) {
      return {
        skipped: `No certificates found for ${domain} in Certificate Transparency logs`,
        retryable: true,
      };
    }
    return { domain, ...summarise(res.data, now) };
  } catch (error) {
    return upstreamError(error, 'Certificate Transparency lookup');
  }
};

export const handler = middleware(certTransparencyHandler);
export default handler;
