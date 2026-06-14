import net from 'net';
import psl from 'psl';
import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { parseTarget } from './_common/parse-target.js';
import { upstreamError } from './_common/upstream.js';

const TIMEOUT = 9000;
const MAX_RESULTS = 30;
const REGION_ENRICH = 14; // Look up the RIR (region) for the top N matches only

const RIR_REGION = {
  ARIN: 'North America',
  'RIPE NCC': 'Europe / Middle East',
  RIPE: 'Europe / Middle East',
  APNIC: 'Asia-Pacific',
  LACNIC: 'Latin America',
  AFRINIC: 'Africa',
};

const MAX_NETWORKS = 50;
const RIPE_NET_TYPES = ['inetnum', 'inet6num', 'route', 'route6'];

const ripestat = async (call, resource) => {
  const res = await httpGet(`https://stat.ripe.net/data/${call}/data.json`, {
    params: { resource },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT,
  });
  return res.data?.data;
};

// RIPE full-text search returns Solr-style docs: { doc: { strs: [{ str: {name,value} }] } }
const flattenDoc = (d) => {
  const o = {};
  for (const s of d.doc?.strs || []) if (s.str) o[s.str.name] = s.str.value;
  return o;
};

// Fallback for orgs without their own ASN: find inetnum/route objects whose
// netname/descr references the brand, in the RIPE database (Europe / Middle East).
const searchRipeNetworks = async (brand) => {
  const res = await httpGet('https://rest.db.ripe.net/fulltextsearch/select.json', {
    params: { q: `"${brand}"`, wt: 'json', rows: 300, start: 0 },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT,
  });
  const docs = res.data?.result?.docs || [];
  const needle = brand.toLowerCase();
  const seen = new Set();
  const networks = [];
  for (const d of docs) {
    const o = flattenDoc(d);
    if (!RIPE_NET_TYPES.includes(o['object-type'])) continue;
    const range = o.inetnum || o.inet6num || o.route || o.route6 || o['lookup-key'];
    const netname = o.netname || '';
    const descr = o.descr || '';
    // Only keep objects that actually reference the brand (avoid incidental matches)
    if (!`${netname} ${descr}`.toLowerCase().includes(needle)) continue;
    if (!range || seen.has(range)) continue;
    seen.add(range);
    networks.push({
      type: o['object-type'],
      range: range.trim(),
      netname: netname || null,
      descr: descr || null,
    });
  }
  return networks;
};

// searchcomplete descriptions look like "HANDLE - Holder Name" (sometimes no dash)
const parseDescription = (desc) => {
  if (!desc) return { handle: null, holder: null };
  const dash = desc.indexOf(' - ');
  if (dash >= 0) return { handle: desc.slice(0, dash).trim(), holder: desc.slice(dash + 3).trim() };
  const sp = desc.indexOf(' ');
  if (sp >= 0) return { handle: desc.slice(0, sp).trim(), holder: desc.slice(sp + 1).trim() };
  return { handle: desc.trim(), holder: null };
};

// Resolve the first A record via DNS-over-HTTPS (no local resolver needed)
const resolveIp = async (host) => {
  const res = await httpGet('https://dns.google/resolve', {
    params: { name: host, type: 'A' },
    headers: { Accept: 'application/dns-json' },
    timeout: TIMEOUT,
  });
  return (res.data?.Answer || []).find((a) => a.type === 1)?.data || null;
};

// Pull a field out of an RDAP entity's jCard (used for the registrant org name)
const vcardField = (entity, field) => {
  const arr = entity?.vcardArray?.[1];
  if (!Array.isArray(arr)) return undefined;
  return arr.find((x) => Array.isArray(x) && x[0] === field)?.[3];
};
const findRole = (entities, role) => {
  for (const e of entities || []) {
    if ((e.roles || []).includes(role)) return e;
    const nested = findRole(e.entities, role);
    if (nested) return nested;
  }
  return undefined;
};

// Normalise to alphanumerics so "GOSCOMB-NET" matches brand "goscomb"
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Look up the registration of the site's serving IP and decide whether it is
// registered to the company itself (own IP space) or to a third party (CDN/host).
const checkIpOwnership = async (host, brand) => {
  const ip = await resolveIp(host);
  if (!ip) return null;
  const res = await httpGet(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
    headers: { Accept: 'application/rdap+json' },
    timeout: TIMEOUT,
  });
  const data = res.data;
  if (!data || typeof data !== 'object' || data.errorCode) {
    return { ip, netname: null, org: null, ownsOwnIp: false };
  }
  const owner = findRole(data.entities, 'registrant') || findRole(data.entities, 'administrative');
  const netname = data.name || null;
  const org = (owner && vcardField(owner, 'fn')) || null;
  const brandN = norm(brand);
  const ownsOwnIp = !!brandN && (norm(netname).includes(brandN) || norm(org).includes(brandN));
  return { ip, netname, org, ownsOwnIp };
};

const orgAsnsHandler = async (url) => {
  const { hostname } = parseTarget(url);
  if (net.isIP(hostname)) {
    return { skipped: 'Organization ASN search needs a domain name, not an IP' };
  }
  const parsed = psl.parse(hostname);
  const brand = (parsed?.sld || hostname.split('.')[0] || '').toLowerCase();
  if (!brand || brand.length < 2) {
    return { skipped: 'Could not derive a company name from the domain' };
  }

  // Does the site serve from its own IP space, or a third party's (CDN/host)?
  const ipOwnership = await checkIpOwnership(hostname, brand).catch(() => null);

  // RIPEstat searchcomplete returns ASNs whose registered name matches the brand,
  // each suggestion carrying the AS handle + holder org in its description.
  let data;
  try {
    data = await ripestat('searchcomplete', brand);
  } catch (error) {
    return upstreamError(error, 'Organization ASN search');
  }

  const asnCat = (data?.categories || []).find((c) => c.category === 'ASNs');
  const suggestions = asnCat?.suggestions || [];

  // No ASN of their own (common for smaller orgs behind a CDN) — fall back to
  // searching the RIPE database for network blocks registered under the brand.
  if (!suggestions.length) {
    let networks = [];
    try {
      networks = await searchRipeNetworks(brand);
    } catch {
      networks = [];
    }
    if (networks.length) {
      return {
        domain: hostname,
        brand,
        ipOwnership,
        asns: [],
        networks: {
          count: networks.length,
          truncated: networks.length > MAX_NETWORKS,
          list: networks.slice(0, MAX_NETWORKS),
        },
        networkSource: 'RIPE database (Europe / Middle East)',
      };
    }
    // No ASN and no network blocks — still report IP ownership if we have it
    if (ipOwnership) {
      return { domain: hostname, brand, ipOwnership, asns: [], source: 'rdap.org' };
    }
    return {
      skipped: `No ASNs or registered network blocks found under a name matching "${brand}"`,
      brand,
    };
  }

  // Rank: a whole-word match of the brand in the holder/handle is a stronger signal
  const word = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  let candidates = suggestions
    .map((s) => {
      const asn = parseInt(String(s.value || s.label).replace(/^AS/i, ''), 10);
      const { handle, holder } = parseDescription(s.description);
      const strong = word.test(holder || '') || word.test(handle || '');
      return { asn, handle, holder, relevance: strong ? 2 : 1 };
    })
    .filter((c) => Number.isFinite(c.asn))
    .sort((a, b) => b.relevance - a.relevance || a.asn - b.asn);

  const total = candidates.length;
  candidates = candidates.slice(0, MAX_RESULTS);

  // Enrich the top matches with their RIR — a coarse "same region" signal
  await Promise.all(
    candidates.slice(0, REGION_ENRICH).map(async (c) => {
      const rir = await ripestat('rir', `AS${c.asn}`).catch(() => null);
      const name = rir?.rirs?.[0]?.rir;
      if (name) {
        c.rir = name;
        c.region = RIR_REGION[name] || name;
      }
    }),
  );

  return {
    domain: hostname,
    brand,
    ipOwnership,
    total,
    truncated: total > MAX_RESULTS,
    asns: candidates,
    source: 'stat.ripe.net',
  };
};

export const handler = middleware(orgAsnsHandler);
export default handler;
