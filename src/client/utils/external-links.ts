// Builders for "view this identifier at the source" links.
//
// bgp.tools is the BGP detail provider: a modern, fast explorer that renders
// ASNs, IP addresses and routed prefixes (peers, upstreams, prefixes, whois,
// DNS, RPKI) with no API key. A bare IP has no dedicated page, so it is routed
// through the search endpoint, which redirects to the covering prefix.

const BGP = 'https://bgp.tools';

/** Strip a leading "AS"/"as" and any surrounding whitespace from an ASN value. */
const asnNumber = (asn: string | number): string => `${asn}`.trim().replace(/^as/i, '');

/** Detail page for an Autonomous System, e.g. AS15169 -> https://bgp.tools/as/15169 */
export const asnUrl = (asn: string | number): string => `${BGP}/as/${asnNumber(asn)}`;

/** Lookup for a single IP address (v4 or v6) — resolves to its covering prefix. */
export const ipUrl = (ip: string): string => `${BGP}/search?q=${encodeURIComponent(ip.trim())}`;

/** Detail page for a routed prefix / CIDR block, e.g. 8.8.8.0/24 -> /prefix/8.8.8.0/24 */
export const prefixUrl = (cidr: string): string => `${BGP}/prefix/${cidr.trim()}`;

/**
 * Qualys SSL Labs report for a domain — the cert's live detail view.
 * Rock-solid uptime and no login, unlike the CT-search engines.
 */
export const sslLabsUrl = (domain: string): string =>
  `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(domain.trim())}`;

/**
 * Web search for an issuer / CA org name. No purpose-built issuer-org search is
 * reliably available without a login (crt.sh is the only one and it's flaky),
 * so a search engine is the dependable "who is this CA" fallback.
 */
export const searchUrl = (query: string): string =>
  `https://duckduckgo.com/?q=${encodeURIComponent(query.trim())}`;

/** Browse to a hostname/domain over https (protocol and trailing dots/slashes stripped). */
export const siteUrl = (host: string): string => {
  const clean = host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[./]+$/, '');
  return `https://${clean}`;
};

/** True for a bare IPv4 or IPv6 address. */
export const isIpAddress = (val: string): boolean => {
  const v = val.trim();
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[0-9a-f]*:[0-9a-f:]+$/i.test(v);
};

/**
 * Best link for a bare host identifier: IP addresses resolve to their bgp.tools
 * prefix, everything else (hostnames, domains) opens over https.
 */
export const hostUrl = (val: string): string =>
  isIpAddress(val) ? ipUrl(val) : siteUrl(val);

/** True for a value that is already a full http(s) URL. */
export const isHttpUrl = (val: string): boolean => /^https?:\/\/\S+$/i.test(val.trim());

/** True for a bare email address. */
export const isEmail = (val: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
