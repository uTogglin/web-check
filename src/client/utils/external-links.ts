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

/** crt.sh certificate-transparency search — used for issuer org names. */
export const crtShUrl = (query: string): string =>
  `https://crt.sh/?q=${encodeURIComponent(query.trim())}`;

/** merklemap cert/subdomain search — a modern, no-login domain explorer. */
export const merklemapUrl = (domain: string): string =>
  `https://www.merklemap.com/search?query=${encodeURIComponent(domain.trim())}`;

/** Browse to a hostname/domain over https (protocol stripped if already present). */
export const siteUrl = (host: string): string => {
  const clean = host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return `https://${clean}`;
};

/** True for a value that is already a full http(s) URL. */
export const isHttpUrl = (val: string): boolean => /^https?:\/\/\S+$/i.test(val.trim());

/** True for a bare email address. */
export const isEmail = (val: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
