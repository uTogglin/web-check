import net from 'net';
import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { parseTarget } from './_common/parse-target.js';
import { upstreamError } from './_common/upstream.js';

const TIMEOUT = 8000;

// Pull a field (fn, email, ...) out of an RDAP entity's jCard
const vcardField = (entity, field) => {
  const arr = entity?.vcardArray?.[1];
  if (!Array.isArray(arr)) return undefined;
  const f = arr.find((x) => Array.isArray(x) && x[0] === field);
  return f?.[3];
};

// RDAP entities can nest (abuse contact under the org), so search depth-first
const findEntityByRole = (entities, role) => {
  for (const e of entities || []) {
    if ((e.roles || []).includes(role)) return e;
    const nested = findEntityByRole(e.entities, role);
    if (nested) return nested;
  }
  return undefined;
};

const findEmailForRole = (entities, role) => {
  const e = findEntityByRole(entities, role);
  return e ? vcardField(e, 'email') : undefined;
};

// Identify the Regional Internet Registry from the RDAP self link
const registryFromLinks = (data) => {
  const self = (data.links || []).find((l) => l.rel === 'self')?.href || '';
  if (/arin/i.test(self)) return 'ARIN (North America)';
  if (/ripe/i.test(self)) return 'RIPE NCC (Europe / Middle East)';
  if (/apnic/i.test(self)) return 'APNIC (Asia-Pacific)';
  if (/lacnic/i.test(self)) return 'LACNIC (Latin America)';
  if (/afrinic/i.test(self)) return 'AFRINIC (Africa)';
  return undefined;
};

const eventDate = (data, action) =>
  (data.events || []).find((e) => e.eventAction === action)?.eventDate;

const toCidr = (c) => {
  if (c.v4prefix) return `${c.v4prefix}/${c.length}`;
  if (c.v6prefix) return `${c.v6prefix}/${c.length}`;
  return null;
};

const ipWhoisHandler = async (url) => {
  const { hostname } = parseTarget(url);
  if (!net.isIP(hostname)) {
    return { skipped: 'IP WHOIS requires a resolved IP address' };
  }

  let data;
  try {
    // rdap.org is a meta-resolver that bootstraps to the correct RIR's RDAP server
    const res = await httpGet(`https://rdap.org/ip/${encodeURIComponent(hostname)}`, {
      headers: { Accept: 'application/rdap+json' },
      timeout: TIMEOUT,
    });
    data = res.data;
  } catch (error) {
    return upstreamError(error, 'IP WHOIS lookup');
  }

  if (!data || typeof data !== 'object' || data.errorCode) {
    return { skipped: 'No WHOIS data available for this IP' };
  }

  const owner =
    findEntityByRole(data.entities, 'registrant') ||
    findEntityByRole(data.entities, 'administrative');

  return {
    ip: hostname,
    handle: data.handle,
    name: data.name,
    type: data.type,
    range:
      data.startAddress && data.endAddress
        ? `${data.startAddress} – ${data.endAddress}`
        : undefined,
    cidr: (data.cidr0_cidrs || []).map(toCidr).filter(Boolean),
    country: data.country,
    registry: registryFromLinks(data),
    organization: owner ? vcardField(owner, 'fn') : undefined,
    abuseContact: findEmailForRole(data.entities, 'abuse'),
    status: Array.isArray(data.status) ? data.status : undefined,
    registered: eventDate(data, 'registration'),
    updated: eventDate(data, 'last changed'),
  };
};

export const handler = middleware(ipWhoisHandler);
export default handler;
