import net from 'net';
import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { parseTarget } from './_common/parse-target.js';
import { upstreamError } from './_common/upstream.js';

const TIMEOUT = 9000;
const LIST_CAP = 150; // Large ASes have hundreds of neighbours/prefixes; cap detail lists

// Call a RIPEstat data endpoint; returns the `data` object or throws on a bad status
const ripestat = async (call, resource) => {
  const res = await httpGet(`https://stat.ripe.net/data/${call}/data.json`, {
    params: { resource },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT,
  });
  if (res.data?.status && res.data.status !== 'ok') {
    throw Object.assign(new Error(`RIPEstat ${call} returned ${res.data.status}`), {
      response: { status: 502 },
    });
  }
  return res.data?.data;
};

const cap = (list) => ({
  count: list.length,
  truncated: list.length > LIST_CAP,
  list: list.slice(0, LIST_CAP),
});

const asnHandler = async (url) => {
  const { hostname } = parseTarget(url);
  if (!net.isIP(hostname)) {
    return { skipped: 'ASN lookup requires a resolved IP address' };
  }

  // Step 1: which prefix + ASN does this IP route through?
  let netinfo;
  try {
    netinfo = await ripestat('network-info', hostname);
  } catch (error) {
    return upstreamError(error, 'ASN lookup');
  }

  const primaryAsn = netinfo?.asns?.[0];
  if (!primaryAsn) {
    return {
      skipped: `No routed ASN found for ${hostname} (it may not be globally announced)`,
      retryable: true,
    };
  }

  // Step 2: everything about that ASN, in parallel
  const safe = (call, resource) => ripestat(call, resource).catch(() => null);
  const asResource = `AS${primaryAsn}`;
  const [overview, neighbours, prefixes] = await Promise.all([
    safe('as-overview', asResource),
    safe('asn-neighbours', asResource),
    safe('announced-prefixes', asResource),
  ]);

  // RIPEstat labels neighbours left (upstream/provider), right (downstream/customer),
  // or uncertain (peer/unknown relationship)
  const nb = neighbours?.neighbours || [];
  const group = (type) =>
    nb
      .filter((n) => n.type === type)
      .sort((a, b) => (b.power || 0) - (a.power || 0))
      .map((n) => ({ asn: n.asn, power: n.power || 0 }));

  const allPrefixes = (prefixes?.prefixes || []).map((p) => p.prefix).filter(Boolean);
  const v4Count = allPrefixes.filter((p) => p.includes('.')).length;

  return {
    ip: hostname,
    prefix: netinfo.prefix || null,
    asns: netinfo.asns || [],
    asn: {
      number: primaryAsn,
      holder: overview?.holder || null,
      announced: overview?.announced ?? null,
      block: overview?.block?.desc || null,
    },
    upstreams: cap(group('left')),
    downstreams: cap(group('right')),
    peers: cap(group('uncertain')),
    neighbourCounts: neighbours?.neighbour_counts || null,
    announcedPrefixes: { v4Count, v6Count: allPrefixes.length - v4Count, ...cap(allPrefixes) },
    source: 'stat.ripe.net',
  };
};

export const handler = middleware(asnHandler);
export default handler;
