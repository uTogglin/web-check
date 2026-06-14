// Browser-side implementations of checks that used to round-trip through our
// serverless functions. Each mirrors the exact response shape of the endpoint
// it replaces (see the matching files in /api), so cards and analyzers consume
// them unchanged. The win: these run from the visitor's browser against public,
// CORS-enabled APIs, so they cost us zero function invocations.

import type { JobContext } from './types';
import { parseJson } from 'client/utils/parse-json';
import {
  dohQuery,
  answersOfType,
  dataOfType,
  parseTxtChunks,
  parseMx,
  parseSoa,
  parseSrv,
  stripTrailingDot,
  hostOf,
  registrableDomain,
  RecordType,
  type DohResponse,
} from 'client/utils/doh';

const isAbort = (e: unknown): boolean => (e as Error)?.name === 'AbortError';

// Resolve with the first fulfilled promise; reject only if all reject. Stands in
// for Promise.any, which needs a newer lib target than this project compiles to.
const firstFulfilled = <T>(promises: Promise<T>[]): Promise<T> =>
  new Promise((resolve, reject) => {
    let remaining = promises.length;
    if (!remaining) {
      reject(new Error('No providers available'));
      return;
    }
    let lastErr: unknown;
    for (const p of promises) {
      p.then(resolve, (err) => {
        lastErr = err;
        if (--remaining === 0) reject(lastErr);
      });
    }
  });

/* ------------------------------------------------------------------ get-ip */
// Resolve the target to an IP. Returns a bare string on success (the get-ip job
// feeds it to IP-dependent jobs), or an { error } object on failure.
export const clientGetIp = async (ctx: JobContext): Promise<string | { error: string }> => {
  const host = hostOf(ctx.address);
  try {
    const a = await dohQuery(host, 'A', { signal: ctx.signal });
    const ip4 = dataOfType(a, RecordType.A)[0];
    if (ip4) return ip4;
    const aaaa = await dohQuery(host, 'AAAA', { signal: ctx.signal });
    const ip6 = dataOfType(aaaa, RecordType.AAAA)[0];
    if (ip6) return ip6;
    return { error: 'Could not resolve an IP address for this host' };
  } catch (err) {
    if (isAbort(err)) throw err;
    return { error: (err as Error).message };
  }
};

/* --------------------------------------------------------------------- dns */
export const clientDns = async (ctx: JobContext) => {
  const host = hostOf(ctx.address);
  const q = (t: keyof typeof RecordType) =>
    dohQuery(host, t, { signal: ctx.signal }).catch((e) => {
      if (isAbort(e)) throw e;
      return null;
    });
  const [a, aaaa, mx, txt, ns, cname, soa, srv, ptr] = await Promise.all([
    q('A'),
    q('AAAA'),
    q('MX'),
    q('TXT'),
    q('NS'),
    q('CNAME'),
    q('SOA'),
    q('SRV'),
    q('PTR'),
  ]);
  return {
    A: dataOfType(a, RecordType.A),
    AAAA: dataOfType(aaaa, RecordType.AAAA),
    MX: answersOfType(mx, RecordType.MX).map(parseMx),
    TXT: answersOfType(txt, RecordType.TXT).map((x) => parseTxtChunks(x.data)),
    NS: dataOfType(ns, RecordType.NS).map(stripTrailingDot),
    CNAME: dataOfType(cname, RecordType.CNAME).map(stripTrailingDot),
    SOA: parseSoa(answersOfType(soa, RecordType.SOA)[0]),
    SRV: answersOfType(srv, RecordType.SRV).map(parseSrv),
    PTR: dataOfType(ptr, RecordType.PTR).map(stripTrailingDot),
  };
};

/* ------------------------------------------------------------- txt-records */
export const clientTxtRecords = async (ctx: JobContext) => {
  const host = hostOf(ctx.address);
  const resp = await dohQuery(host, 'TXT', { signal: ctx.signal });
  const answers = answersOfType(resp, RecordType.TXT);
  if (!answers.length) return { skipped: 'No TXT records for this host' };

  // Join chunks, then split into key=value, deduping repeated keys (matches api/txt-records)
  const result: Record<string, string> = {};
  for (const ans of answers) {
    const full = parseTxtChunks(ans.data).join('');
    const eq = full.indexOf('=');
    let key = eq > 0 ? full.slice(0, eq) : full;
    const val = eq > 0 ? full.slice(eq + 1) : '';
    while (key in result) key += '_';
    result[key] = val;
  }
  return result;
};

/* --------------------------------------------------------------------- caa */
// Parse a CAA record's presentation-format data, e.g. `0 issue "letsencrypt.org"`
const parseCaa = (data: string) => {
  const match = data.match(/^\s*(\d+)\s+(\S+)\s+"?([^"]*)"?\s*$/);
  if (!match) return { flags: null, tag: null, value: data.trim() };
  return {
    flags: parseInt(match[1], 10),
    critical: (parseInt(match[1], 10) & 128) !== 0,
    tag: match[2].toLowerCase(),
    value: match[3],
  };
};

export const clientCaa = async (ctx: JobContext) => {
  const host = hostOf(ctx.address);
  const apex = await registrableDomain(host);

  // CAA records inherit down the tree, so walk up from the host toward the apex
  const labels = host.split('.');
  const candidates: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const name = labels.slice(i).join('.');
    candidates.push(name);
    if (name === apex) break;
  }

  let matchedAt: string | null = null;
  let answers: Array<{ data: string; TTL: number; name: string }> = [];
  for (const name of candidates) {
    const resp = await dohQuery(name, 'CAA', { signal: ctx.signal, prefer: 'google' }).catch((e) => {
      if (isAbort(e)) throw e;
      return null;
    });
    const found = answersOfType(resp, RecordType.CAA);
    if (found.length) {
      matchedAt = name;
      answers = found;
      break;
    }
  }

  const records = answers.map((a) => ({ ...parseCaa(a.data), TTL: a.TTL, name: a.name }));
  const valuesFor = (tag: string) =>
    records.filter((r) => r.tag === tag && r.value).map((r) => r.value);

  return {
    hasCaa: records.length > 0,
    isEnforced: records.some((r) => r.tag === 'issue' || r.tag === 'issuewild'),
    inheritedFrom: matchedAt && matchedAt !== host ? matchedAt : null,
    issuers: valuesFor('issue'),
    wildcardIssuers: valuesFor('issuewild'),
    iodef: valuesFor('iodef'),
    records,
  };
};

/* ------------------------------------------------------------------ dnssec */
export const clientDnssec = async (ctx: JobContext) => {
  const host = hostOf(ctx.address);
  const opt = { signal: ctx.signal, prefer: 'google' as const };
  const [dnskey, ds, aRecord] = await Promise.all([
    dohQuery(host, 'DNSKEY', opt),
    dohQuery(host, 'DS', opt),
    dohQuery(host, 'A', opt),
  ]);
  const wrap = (resp: DohResponse) =>
    resp.Answer
      ? { isFound: true, answer: resp.Answer, response: resp.Answer }
      : { isFound: false, answer: null, response: resp };
  return {
    DNSKEY: wrap(dnskey),
    DS: wrap(ds),
    RRSIG: { isFound: !!aRecord.AD, answer: null, response: aRecord },
  };
};

/* ------------------------------------------------------------- mail-config */
const DKIM_SELECTORS = [
  'default',
  'google',
  'selector1',
  'selector2',
  'k1',
  'k2',
  'k3',
  's1',
  's2',
  'dkim',
  'mail',
];

const MX_PROVIDERS: Array<[RegExp, string]> = [
  [/google(mail)?\.com$/i, 'Google Workspace'],
  [/outlook\.com$|microsoft\.com$/i, 'Microsoft 365'],
  [/protonmail\.ch$|protonme\.ch$/i, 'ProtonMail'],
  [/zoho\.(com|eu|in)$/i, 'Zoho Mail'],
  [/yahoodns\.net$/i, 'Yahoo Mail'],
  [/mimecast\.com$/i, 'Mimecast'],
  [/pphosted\.com$/i, 'Proofpoint'],
  [/messagelabs\.com$/i, 'Broadcom Email Security'],
  [/iphmx\.com$/i, 'Cisco Email Security'],
  [/mailgun\.org$/i, 'Mailgun'],
  [/sendgrid\.net$/i, 'SendGrid'],
  [/fireeyecloud\.com$/i, 'Trellix Email Security'],
  [/barracudanetworks\.com$/i, 'Barracuda'],
];

const detectProviders = (mxRecords: Array<{ exchange: string }>) => {
  const seen = new Set<string>();
  return mxRecords.reduce<Array<{ provider: string; value: string }>>((out, { exchange }) => {
    const match = MX_PROVIDERS.find(([re]) => re.test(exchange));
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      out.push({ provider: match[1], value: exchange });
    }
    return out;
  }, []);
};

export const clientMailConfig = async (ctx: JobContext) => {
  const domain = hostOf(ctx.address);
  const safeTxt = (name: string): Promise<string[][]> =>
    dohQuery(name, 'TXT', { signal: ctx.signal })
      .then((r) => answersOfType(r, RecordType.TXT).map((a) => parseTxtChunks(a.data)))
      .catch((e) => {
        if (isAbort(e)) throw e;
        return [];
      });

  // Try common DKIM selectors; skip revoked keys (empty p= value)
  const findDkim = async (): Promise<Array<{ selector: string; record: string[] }>> => {
    const checks = DKIM_SELECTORS.map((s) =>
      safeTxt(`${s}._domainkey.${domain}`).then((records) => {
        if (!records.length) return null;
        const txt = records[0].join('');
        if (/p=\s*(;|$)/.test(txt)) return null;
        return { selector: s, record: records[0] };
      }),
    );
    return (await Promise.all(checks)).filter(
      (r): r is { selector: string; record: string[] } => r !== null,
    );
  };

  let mxResp: DohResponse | null;
  try {
    mxResp = await dohQuery(domain, 'MX', { signal: ctx.signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { error: `Mail config lookup failed: ${(err as Error).message}` };
  }
  const mxRecords = answersOfType(mxResp, RecordType.MX).map(parseMx);
  if (!mxRecords.length) return { skipped: 'No mail server in use on this domain' };

  const [rootTxt, dmarcTxt, bimiTxt, dkimResults] = await Promise.all([
    safeTxt(domain),
    safeTxt(`_dmarc.${domain}`),
    safeTxt(`default._bimi.${domain}`),
    findDkim(),
  ]);

  // Collect only email-relevant TXT records (SPF at the root, plus DMARC/BIMI/DKIM)
  const emailTxt = rootTxt.filter((chunks) => chunks.join('').toLowerCase().startsWith('v=spf1'));
  dmarcTxt.forEach((r) => emailTxt.push(r));
  bimiTxt.forEach((r) => emailTxt.push(r));
  dkimResults.forEach(({ record }) => emailTxt.push(record));

  return {
    mxRecords,
    txtRecords: emailTxt,
    mailServices: detectProviders(mxRecords),
  };
};

/* ------------------------------------------------------------------- whois */
// RDAP is the JSON successor to port-43 WHOIS and most registries serve it with
// permissive CORS, so the browser can fetch registration data directly. Some
// ccTLD RDAP servers omit CORS headers; those degrade to a "no data" skip.
const toIso = (raw?: string): string | undefined => {
  if (!raw || typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  const t = Date.parse(trimmed);
  return Number.isNaN(t) ? raw : new Date(t).toISOString();
};

const cleanNs = (ns?: string[]): string[] | undefined => {
  if (!Array.isArray(ns)) return undefined;
  const out = [...new Set(ns.map((n) => String(n).trim().toLowerCase()).filter(Boolean))];
  return out.length ? out : undefined;
};

// Pull the formatted-name value out of an RDAP entity's vCard
const vcardFn = (vcard: any): string | undefined => {
  if (!Array.isArray(vcard?.[1])) return undefined;
  const fn = vcard[1].find((f: any) => Array.isArray(f) && f[0] === 'fn');
  return fn?.[3] || undefined;
};

const mapRdap = (data: any, fallbackDomain: string) => {
  if (!data || data.errorCode || data.objectClassName === 'error') return null;
  const events: any[] = data.events || [];
  const evt = (action: string) => events.find((e) => e.eventAction === action)?.eventDate;
  const registrar = (data.entities || []).find((e: any) => (e.roles || []).includes('registrar'));
  const ianaId = registrar?.publicIds?.find((p: any) => /iana/i.test(p.type))?.identifier;
  const registrarUrl = registrar?.links?.find(
    (l: any) => l.rel === 'about' || l.rel === 'related',
  )?.href;

  const result = {
    domain: data.ldhName || fallbackDomain,
    registrar: vcardFn(registrar?.vcardArray),
    registrarUrl,
    registrarIanaId: ianaId,
    registrarWhoisServer: data.port43,
    registryDomainId: data.handle,
    created: toIso(evt('registration')),
    updated: toIso(evt('last changed') || evt('last update of RDAP database')),
    expires: toIso(evt('expiration')),
    nameservers: cleanNs((data.nameservers || []).map((n: any) => n.ldhName).filter(Boolean)),
    status: data.status,
    dnssec: data.secureDNS?.delegationSigned ? 'signed' : 'unsigned',
  };

  const useful =
    result.created || result.updated || result.expires || result.registrar || result.nameservers;
  return useful ? result : null;
};

// Server fallback: when the browser can't read RDAP directly (a CORS-less ccTLD
// server, or no useful data), invoke our endpoint, which runs the full whoiser +
// RDAP lookup over raw sockets. Only reached on the minority of domains that the
// fast path can't handle, so the common case still costs zero invocations.
const serverWhois = async (ctx: JobContext) => {
  try {
    const res = await fetch(`${ctx.api}/whois?url=${encodeURIComponent(ctx.address)}`, {
      signal: ctx.signal,
    });
    return await parseJson(res);
  } catch (err) {
    if (isAbort(err)) throw err;
    return { skipped: 'No WHOIS data available for this domain' };
  }
};

export const clientWhois = async (ctx: JobContext) => {
  const host = hostOf(ctx.address);
  const domain = await registrableDomain(host);

  // Fast path: RDAP straight from the browser. Most gTLD RDAP servers send
  // permissive CORS headers, so this resolves without ever hitting our backend.
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: ctx.signal,
    });
    if (res.ok) {
      const mapped = mapRdap(await res.json(), domain);
      if (mapped) return mapped;
    }
  } catch (err) {
    if (isAbort(err)) throw err;
    // A missing Access-Control-Allow-Origin header surfaces here as a TypeError
    // ("Failed to fetch") indistinguishable from a network error — either way,
    // fall through to the server, which isn't bound by the browser's CORS rules.
  }

  return serverWhois(ctx);
};

/* ---------------------------------------------------------------- location */
// CORS-enabled, HTTPS geo-IP providers (api/location also tries ip-api.com, but
// that's HTTP-only and would be blocked as mixed content from an HTTPS page).
const geoProviders = [
  {
    name: 'ipwho.is',
    url: (ip: string) => `https://ipwho.is/${ip}`,
    parse: (d: any) =>
      d?.success === false
        ? null
        : {
            ip: d.ip,
            city: d.city,
            region: d.region,
            country_name: d.country,
            country_code: d.country_code,
            region_code: d.region_code,
            postal: d.postal,
            latitude: d.latitude,
            longitude: d.longitude,
            org: d.connection?.isp || d.connection?.org,
            timezone: d.timezone?.id,
          },
  },
  {
    name: 'geojs.io',
    url: (ip: string) => `https://get.geojs.io/v1/ip/geo/${ip}.json`,
    parse: (d: any) =>
      d?.country_code
        ? {
            ip: d.ip,
            city: d.city,
            region: d.region,
            country_name: d.country,
            country_code: d.country_code,
            latitude: d.latitude !== 'nil' ? parseFloat(d.latitude) : undefined,
            longitude: d.longitude !== 'nil' ? parseFloat(d.longitude) : undefined,
            org: d.organization_name,
            timezone: d.timezone,
          }
        : null,
  },
  {
    name: 'reallyfreegeoip.org',
    url: (ip: string) => `https://reallyfreegeoip.org/json/${ip}`,
    parse: (d: any) =>
      d?.country_code
        ? {
            ip: d.ip,
            city: d.city,
            region: d.region_name,
            country_name: d.country_name,
            country_code: d.country_code,
            region_code: d.region_code,
            postal: d.zip_code,
            latitude: d.latitude,
            longitude: d.longitude,
            timezone: d.time_zone,
          }
        : null,
  },
];

const getJson = async (url: string, signal?: AbortSignal) => {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json();
};

// Strip empty values so they don't shadow enrichment defaults during merge
const compact = (o: Record<string, any>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// Country-level metadata to fill fields not provided by every geo source
const enrichCountry = async (code: string | undefined, signal?: AbortSignal) => {
  if (!code) return {};
  try {
    const data = await getJson(
      `https://restcountries.com/v3.1/alpha/${code}?fields=tld,languages,currencies,area,population`,
      signal,
    );
    const c = Array.isArray(data) ? data[0] : data;
    if (!c) return {};
    const languages = c.languages ? Object.values(c.languages).join(', ') : undefined;
    const currCode = c.currencies ? Object.keys(c.currencies)[0] : undefined;
    const curr = currCode ? c.currencies[currCode] : null;
    return {
      country_tld: c.tld?.[0],
      languages,
      currency: currCode,
      currency_name: curr?.name,
      country_area: c.area,
      country_population: c.population,
    };
  } catch {
    return {};
  }
};

export const clientLocation = async (ctx: JobContext) => {
  const ip = ctx.ipAddress;
  if (!ip) return { error: 'No IP address available for location lookup' };

  const tasks = geoProviders.map(async (p) => {
    const parsed = p.parse(await getJson(p.url(ip), ctx.signal));
    if (!parsed?.country_code) throw new Error('no usable data');
    return parsed;
  });

  let geo: any;
  try {
    geo = await firstFulfilled(tasks);
  } catch {
    return { error: 'IP location lookup unavailable across all providers, please try again later' };
  }

  const enrichment = await enrichCountry(geo.country_code, ctx.signal);
  return { ...enrichment, ...compact(geo) };
};

/* -------------------------------------------------------------- screenshot */
// Render the page via Microlink's hosted screenshot API (free tier, CORS-enabled)
// instead of running a headless browser ourselves — no Chromium on the backend
// at all. Returns { data: <image url> }, which the Screenshot card renders
// directly through its `data` field.
export const clientScreenshot = async (ctx: JobContext) => {
  const target = /^https?:\/\//i.test(ctx.address) ? ctx.address : `https://${ctx.address}`;
  const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(target)}&screenshot=true&meta=false`;
  try {
    const res = await fetch(endpoint, { signal: ctx.signal });
    const json = await res.json();
    const url = json?.data?.screenshot?.url;
    if (!url) {
      return { skipped: json?.message || 'No screenshot available for this site' };
    }
    return { data: url };
  } catch (err) {
    if (isAbort(err)) throw err;
    return { error: `Screenshot service unavailable: ${(err as Error).message}` };
  }
};
