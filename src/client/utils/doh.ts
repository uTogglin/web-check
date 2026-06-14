// DNS-over-HTTPS client.
//
// Replaces a cluster of server-side DNS lookups (api/dns, api/txt-records,
// api/caa, api/dnssec, api/mail-config, api/get-ip) with direct, CORS-enabled
// JSON queries from the browser. Cloudflare and Google both serve the standard
// `application/dns-json` shape with `Access-Control-Allow-Origin: *`, so the
// user's browser does the lookup and our serverless functions are never billed.

export interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DohResponse {
  Status: number; // 0 = NOERROR, 3 = NXDOMAIN
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question?: Array<{ name: string; type: number }>;
  Answer?: DohAnswer[];
  Authority?: DohAnswer[];
}

// Numeric DNS record types, as they appear in DoH `Answer[].type`
export const RecordType = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  DS: 43,
  DNSKEY: 48,
  CAA: 257,
} as const;

const PROVIDERS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/resolve',
} as const;

type ProviderKey = keyof typeof PROVIDERS;

interface QueryOptions {
  signal?: AbortSignal;
  // Which resolver to try first; the other is used as a fallback. CAA/DNSSEC
  // parsing assumes Google's presentation-format rdata, so those prefer google.
  prefer?: ProviderKey;
}

const fetchProvider = async (
  base: string,
  name: string,
  type: string,
  signal?: AbortSignal,
): Promise<DohResponse> => {
  const url = `${base}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const res = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal });
  if (!res.ok) throw new Error(`DoH lookup failed (${res.status})`);
  return res.json();
};

// Query a record type, falling back to the second resolver on transient failure.
export const dohQuery = async (
  name: string,
  type: keyof typeof RecordType,
  opts: QueryOptions = {},
): Promise<DohResponse> => {
  const order: ProviderKey[] =
    opts.prefer === 'google' ? ['google', 'cloudflare'] : ['cloudflare', 'google'];
  let lastErr: unknown;
  for (const key of order) {
    try {
      return await fetchProvider(PROVIDERS[key], name, type, opts.signal);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('DoH query failed');
};

const stripDot = (s: string): string => s.replace(/\.$/, '');

export const answersOfType = (resp: DohResponse | null, type: number): DohAnswer[] =>
  (resp?.Answer || []).filter((a) => a.type === type);

export const dataOfType = (resp: DohResponse | null, type: number): string[] =>
  answersOfType(resp, type).map((a) => a.data);

// A TXT record's rdata arrives as one or more quoted strings (DNS splits long
// records into 255-byte chunks). Return them as a chunk array, matching the
// shape Node's dns.resolveTxt produces, so downstream joins behave identically.
export const parseTxtChunks = (data: string): string[] => {
  const matches = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (matches) return matches.map((s) => s.slice(1, -1).replace(/\\(.)/g, '$1'));
  return [data];
};

// `"10 mail.example.com."` -> { priority: 10, exchange: 'mail.example.com' }
export const parseMx = (a: DohAnswer): { priority: number; exchange: string } => {
  const [priority, exchange = ''] = a.data.split(/\s+/);
  return { priority: parseInt(priority, 10), exchange: stripDot(exchange) };
};

// `"ns hostmaster serial refresh retry expire minttl"` -> Node resolveSoa shape
export const parseSoa = (
  a: DohAnswer | undefined,
): {
  nsname: string;
  hostmaster: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
} | null => {
  if (!a) return null;
  const [nsname, hostmaster, serial, refresh, retry, expire, minttl] = a.data.split(/\s+/);
  return {
    nsname: stripDot(nsname || ''),
    hostmaster: stripDot(hostmaster || ''),
    serial: Number(serial),
    refresh: Number(refresh),
    retry: Number(retry),
    expire: Number(expire),
    minttl: Number(minttl),
  };
};

// `"priority weight port target"` -> Node resolveSrv shape
export const parseSrv = (
  a: DohAnswer,
): { priority: number; weight: number; port: number; name: string } => {
  const [priority, weight, port, name = ''] = a.data.split(/\s+/);
  return {
    priority: Number(priority),
    weight: Number(weight),
    port: Number(port),
    name: stripDot(name),
  };
};

export const stripTrailingDot = stripDot;

// Extract a bare hostname from a URL, bare host, or IP address.
export const hostOf = (address: string): string => {
  try {
    const withScheme = /^https?:\/\//i.test(address) ? address : `https://${address}`;
    return new URL(withScheme).hostname.replace(/^\[|]$/g, '');
  } catch {
    return address;
  }
};

// Reduce a hostname to its registrable (apex) domain. Loads the public suffix
// list lazily as its own chunk so it never weighs down the initial bundle;
// only the WHOIS and CAA checks pull it in, on demand.
export const registrableDomain = async (host: string): Promise<string> => {
  try {
    const mod: any = await import('psl');
    const parse: (h: string) => { domain?: string } | null = mod.parse ?? mod.default?.parse;
    return parse?.(host)?.domain || host;
  } catch {
    return host;
  }
};
