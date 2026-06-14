// Builders for "view this identifier at the source" links.
//
// Hurricane Electric's BGP toolkit (bgp.he.net) is used as the detail provider:
// it renders ASNs, IP addresses and routed prefixes in one consistent, readable
// place (peers, prefixes, whois, geolocation) and needs no API key.

const HE = 'https://bgp.he.net';

/** Strip a leading "AS"/"as" and any surrounding whitespace from an ASN value. */
const asnNumber = (asn: string | number): string => `${asn}`.trim().replace(/^as/i, '');

/** Detail page for an Autonomous System, e.g. AS15169 -> https://bgp.he.net/AS15169 */
export const asnUrl = (asn: string | number): string => `${HE}/AS${asnNumber(asn)}`;

/** Detail page for a single IP address (v4 or v6). */
export const ipUrl = (ip: string): string => `${HE}/ip/${encodeURIComponent(ip.trim())}`;

/** Detail page for a routed prefix / CIDR block, e.g. 8.8.8.0/24 -> /net/8.8.8.0/24 */
export const prefixUrl = (cidr: string): string => `${HE}/net/${cidr.trim()}`;

/** crt.sh certificate-transparency search for a domain or issuer. */
export const crtShUrl = (query: string): string =>
  `https://crt.sh/?q=${encodeURIComponent(query.trim())}`;

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
