import { parseJson } from 'client/utils/parse-json';
import { getApiAuthHeaders, clearApiAuth } from 'client/utils/api-auth';
import { subscribeToScan } from 'client/utils/scan-stream';
import { getLocation, parseShodanResults } from 'client/utils/result-processor';
import {
  clientGetIp,
  clientLocation,
  clientWhois,
  clientDns,
  clientDnssec,
  clientCaa,
  clientMailConfig,
  clientTxtRecords,
  clientScreenshot,
} from 'client/jobs/client-checks';

import ServerLocationCard from 'client/components/Results/ServerLocation';
import ServerInfoCard from 'client/components/Results/ServerInfo';
import HostNamesCard from 'client/components/Results/HostNames';
import WhoIsCard from 'client/components/Results/WhoIs';
import LighthouseCard from 'client/components/Results/Lighthouse';
import ScreenshotCard from 'client/components/Results/Screenshot';
import SslCertCard from 'client/components/Results/SslCert';
import HeadersCard from 'client/components/Results/Headers';
import CookiesCard from 'client/components/Results/Cookies';
import RobotsTxtCard from 'client/components/Results/RobotsTxt';
import DnsRecordsCard from 'client/components/Results/DnsRecords';
import RedirectsCard from 'client/components/Results/Redirects';
import TxtRecordCard from 'client/components/Results/TxtRecords';
import ServerStatusCard from 'client/components/Results/ServerStatus';
import OpenPortsCard from 'client/components/Results/OpenPorts';
import TraceRouteCard from 'client/components/Results/TraceRoute';
import CarbonFootprintCard from 'client/components/Results/CarbonFootprint';
import DnsSecCard from 'client/components/Results/DnsSec';
import HstsCard from 'client/components/Results/Hsts';
import SitemapCard from 'client/components/Results/Sitemap';
import DomainLookup from 'client/components/Results/DomainLookup';
import DnsServerCard from 'client/components/Results/DnsServer';
import TechStackCard from 'client/components/Results/TechStack';
import SecurityTxtCard from 'client/components/Results/SecurityTxt';
import ContentLinksCard from 'client/components/Results/ContentLinks';
import SocialTagsCard from 'client/components/Results/SocialTags';
import MailConfigCard from 'client/components/Results/MailConfig';
import HttpSecurityCard from 'client/components/Results/HttpSecurity';
import FirewallCard from 'client/components/Results/Firewall';
import ArchivesCard from 'client/components/Results/Archives';
import RankCard from 'client/components/Results/Rank';
import BlockListsCard from 'client/components/Results/BlockLists';
import ThreatsCard from 'client/components/Results/Threats';
import TlsConnectionCard from 'client/components/Results/TlsConnection';
import TlsSecurityAuditCard from 'client/components/Results/TlsSecurityAudit';
import TlsClientCompatCard from 'client/components/Results/TlsClientCompat';
import SubdomainsCard from 'client/components/Results/Subdomains';
import CaaCard from 'client/components/Results/Caa';
import CertTransparencyCard from 'client/components/Results/CertTransparency';
import EmailSecurityCard from 'client/components/Results/EmailSecurity';
import ThirdPartyCard from 'client/components/Results/ThirdParty';
import IpWhoisCard from 'client/components/Results/IpWhois';
import AsnCard from 'client/components/Results/Asn';
import OrgAsnsCard from 'client/components/Results/OrgAsns';

import type { JobSpec, JobContext, JobsState } from './types';

const URL_ONLY = ['url'] as const;

// Build a fetcher that hits a local /api path then maps the success body
const fetchAndProcess =
  (path: string, process: (raw: any) => any = (r) => r) =>
  async (ctx: JobContext) => {
    const target = path.includes('${ip}') ? ctx.ipAddress || '' : ctx.address;
    const url = path.replace(/\$\{(ip|url)\}/g, target);
    const headers = await getApiAuthHeaders();
    const res = await fetch(`${ctx.api}/${url}`, {
      signal: ctx.signal,
      headers,
      credentials: 'include', // send the session cookie paired with the token
    });
    if (res.status === 403) clearApiAuth(); // session may have expired; force re-solve next time
    const raw = await parseJson(res);
    return raw?.error ? raw : process(raw);
  };

// Build a fetcher that reads a check's body from the shared /api/scan stream
const fromStream =
  (check: string, process: (raw: any) => any = (r) => r) =>
  async (ctx: JobContext) => {
    const raw = await subscribeToScan(
      {
        api: ctx.api,
        address: ctx.address,
        ipAddress: ctx.ipAddress,
        scanKey: ctx.scanKey,
        scanSignal: ctx.scanSignal,
      },
      check,
    );
    if (raw?.status === 403) clearApiAuth(); // not expected from stream, but keep parity
    return raw?.error ? raw : process(raw);
  };

// Sleep ms, reject AbortError if signal fires
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const remove = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(remove, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

// Re-run fetchOnce while shouldRetry(raw) holds, sleeping delay ms between attempts
const retrying = (
  path: string,
  shouldRetry: (raw: any) => boolean,
  attempts: number,
  delay: number,
  onExhausted: (last: any) => any,
) => {
  const fetchOnce = fetchAndProcess(path);
  return async (ctx: JobContext) => {
    let last: any;
    for (let i = 0; i < attempts; i++) {
      last = await fetchOnce(ctx);
      if (!shouldRetry(last)) return last;
      if (i < attempts - 1) await sleep(delay, ctx.signal);
    }
    return onExhausted(last);
  };
};

// Re-run while the body has { pending: true }
const fetchAndPoll = (path: string) =>
  retrying(
    path,
    (r) => !!r?.pending,
    6,
    30000,
    () => ({
      error: 'Timed-out waiting for assessment',
    }),
  );

// Re-run on transient errors or when the server hints `retryable: true`
const fetchAndRetry = (path: string) =>
  retrying(
    path,
    (r) => !!r?.error || !!r?.retryable,
    3,
    2000,
    (last) => last,
  );

const card = (
  id: string,
  title: string,
  tags: string[],
  Component: any,
  extras: { pick?: any; fallback?: any } = {},
) => ({ id, title, tags, Component, ...extras });

// Pick a child key of the raw response, null when missing so cards hide cleanly
const at = (key: string) => (raw: any) => raw?.[key] ?? null;

export const jobs: JobSpec[] = [
  {
    id: 'get-ip',
    cards: [],
    expectedAddressTypes: [...URL_ONLY],
    fetcher: clientGetIp,
  },
  {
    id: 'location',
    needsIp: true,
    cards: [
      card('location', 'Server Location', ['server'], ServerLocationCard, { pick: getLocation }),
    ],
    fetcher: clientLocation,
  },
  {
    id: 'ssl',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('ssl', 'SSL Certificate', ['server', 'security'], SslCertCard)],
    streamed: true,
    fetcher: fromStream('ssl'),
    retryFetcher: fetchAndProcess('ssl?url=${url}'),
  },
  {
    id: 'whois',
    expectedAddressTypes: [...URL_ONLY],
    cards: [
      card('domain', 'Domain Whois', ['server'], DomainLookup),
      card('whois', 'Domain Info', ['server'], WhoIsCard),
    ],
    // RDAP runs in-browser, but the fallback rides the shared /api/scan stream.
    // Mark streamed so it fires only once the IP outcome is known — otherwise an
    // early RDAP-miss could open the stream before the IP is resolved, sending
    // the ip-keyed checks (shodan/ports/asn/ip-whois) with no IP.
    streamed: true,
    fetcher: clientWhois,
  },
  {
    id: 'quality',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('quality', 'Quality Summary', ['client'], LighthouseCard)],
    streamed: true,
    fetcher: fromStream('quality'),
    retryFetcher: fetchAndRetry('quality?url=${url}'),
  },
  {
    id: 'tech-stack',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('tech-stack', 'Tech Stack', ['client', 'meta'], TechStackCard)],
    streamed: true,
    fetcher: fromStream('tech-stack'),
    retryFetcher: fetchAndProcess('tech-stack?url=${url}'),
  },
  {
    id: 'shodan',
    needsIp: true,
    cards: [
      card('hosts', 'Host Names', ['server'], HostNamesCard, { pick: at('hostnames') }),
      card('server-info', 'Server Info', ['server'], ServerInfoCard, { pick: at('serverInfo') }),
    ],
    streamed: true,
    fetcher: fromStream('shodan', parseShodanResults),
    retryFetcher: fetchAndProcess('shodan?url=${ip}', parseShodanResults),
  },
  {
    id: 'cookies',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('cookies', 'Cookies', ['client', 'security'], CookiesCard)],
    streamed: true,
    fetcher: fromStream('cookies'),
    retryFetcher: fetchAndProcess('cookies?url=${url}'),
  },
  {
    id: 'headers',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('headers', 'Headers', ['client', 'security'], HeadersCard)],
    streamed: true,
    fetcher: fromStream('headers'),
    retryFetcher: fetchAndProcess('headers?url=${url}'),
  },
  {
    id: 'dns',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('dns', 'DNS Records', ['server'], DnsRecordsCard)],
    fetcher: clientDns,
  },
  {
    id: 'http-security',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('http-security', 'HTTP Security', ['security'], HttpSecurityCard)],
    streamed: true,
    fetcher: fromStream('http-security'),
    retryFetcher: fetchAndProcess('http-security?url=${url}'),
  },
  {
    id: 'tls-connection',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('tls-connection', 'TLS Connection', ['server', 'security'], TlsConnectionCard)],
    streamed: true,
    fetcher: fromStream('tls-connection'),
    retryFetcher: fetchAndProcess('tls-connection?url=${url}'),
  },
  {
    id: 'tls-labs',
    expectedAddressTypes: [...URL_ONLY],
    cards: [
      card('tls-security-audit', 'TLS Security Audit', ['security'], TlsSecurityAuditCard),
      card('tls-client-compat', 'TLS Client Compatibility', ['security'], TlsClientCompatCard),
    ],
    streamed: true,
    fetcher: fromStream('tls-labs'),
    retryFetcher: fetchAndPoll('tls-labs?url=${url}'),
  },
  {
    id: 'subdomains',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('subdomains', 'Subdomains', ['server', 'meta'], SubdomainsCard)],
    streamed: true,
    fetcher: fromStream('subdomains'),
    retryFetcher: fetchAndRetry('subdomains?url=${url}'),
  },
  {
    id: 'trace-route',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('trace-route', 'Trace Route', ['server'], TraceRouteCard)],
    streamed: true,
    fetcher: fromStream('trace-route'),
    retryFetcher: fetchAndProcess('trace-route?url=${url}'),
  },
  {
    id: 'security-txt',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('security-txt', 'Security.Txt', ['security'], SecurityTxtCard)],
    streamed: true,
    fetcher: fromStream('security-txt'),
    retryFetcher: fetchAndProcess('security-txt?url=${url}'),
  },
  {
    id: 'dns-server',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('dns-server', 'Server Info', ['server'], DnsServerCard)],
    streamed: true,
    fetcher: fromStream('dns-server'),
    retryFetcher: fetchAndProcess('dns-server?url=${url}'),
  },
  {
    id: 'firewall',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('firewall', 'Firewall', ['server', 'security'], FirewallCard)],
    streamed: true,
    fetcher: fromStream('firewall'),
    retryFetcher: fetchAndProcess('firewall?url=${url}'),
  },
  {
    id: 'dnssec',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('dnssec', 'DNSSEC', ['security'], DnsSecCard)],
    fetcher: clientDnssec,
  },
  {
    id: 'caa',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('caa', 'CAA Records', ['server', 'security'], CaaCard)],
    fetcher: clientCaa,
  },
  {
    id: 'cert-transparency',
    expectedAddressTypes: [...URL_ONLY],
    cards: [
      card('cert-transparency', 'Certificate Transparency', ['security', 'meta'], CertTransparencyCard),
    ],
    streamed: true,
    fetcher: fromStream('cert-transparency'),
    retryFetcher: fetchAndRetry('cert-transparency?url=${url}'),
  },
  {
    id: 'email-security',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('email-security', 'Email Security', ['security', 'server'], EmailSecurityCard)],
    streamed: true,
    fetcher: fromStream('email-security'),
    retryFetcher: fetchAndProcess('email-security?url=${url}'),
  },
  {
    id: 'third-party',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('third-party', 'Third-Party Trackers', ['client', 'security'], ThirdPartyCard)],
    streamed: true,
    fetcher: fromStream('third-party'),
    retryFetcher: fetchAndProcess('third-party?url=${url}'),
  },
  {
    id: 'hsts',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('hsts', 'HSTS Check', ['security'], HstsCard)],
    streamed: true,
    fetcher: fromStream('hsts'),
    retryFetcher: fetchAndProcess('hsts?url=${url}'),
  },
  {
    id: 'threats',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('threats', 'Threats', ['security'], ThreatsCard)],
    streamed: true,
    fetcher: fromStream('threats'),
    retryFetcher: fetchAndProcess('threats?url=${url}'),
  },
  {
    id: 'mail-config',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('mail-config', 'Email Configuration', ['server'], MailConfigCard)],
    fetcher: clientMailConfig,
  },
  {
    id: 'archives',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('archives', 'Archive History', ['meta'], ArchivesCard)],
    streamed: true,
    fetcher: fromStream('archives'),
    retryFetcher: fetchAndRetry('archives?url=${url}'),
  },
  {
    id: 'rank',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('rank', 'Global Ranking', ['meta'], RankCard)],
    streamed: true,
    fetcher: fromStream('rank'),
    retryFetcher: fetchAndProcess('rank?url=${url}'),
  },
  {
    id: 'redirects',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('redirects', 'Redirects', ['meta'], RedirectsCard)],
    streamed: true,
    fetcher: fromStream('redirects'),
    retryFetcher: fetchAndProcess('redirects?url=${url}'),
  },
  {
    id: 'linked-pages',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('linked-pages', 'Linked Pages', ['client', 'meta'], ContentLinksCard)],
    streamed: true,
    fetcher: fromStream('linked-pages'),
    retryFetcher: fetchAndProcess('linked-pages?url=${url}'),
  },
  {
    id: 'robots-txt',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('robots-txt', 'Crawl Rules', ['meta'], RobotsTxtCard)],
    streamed: true,
    fetcher: fromStream('robots-txt'),
    retryFetcher: fetchAndProcess('robots-txt?url=${url}'),
  },
  {
    id: 'status',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('status', 'Server Status', ['server'], ServerStatusCard)],
    streamed: true,
    fetcher: fromStream('status'),
    retryFetcher: fetchAndProcess('status?url=${url}'),
  },
  {
    id: 'ports',
    needsIp: true,
    cards: [card('ports', 'Open Ports', ['server'], OpenPortsCard)],
    streamed: true,
    fetcher: fromStream('ports'),
    retryFetcher: fetchAndProcess('ports?url=${ip}'),
  },
  {
    id: 'ip-whois',
    needsIp: true,
    cards: [card('ip-whois', 'IP WHOIS', ['server', 'meta'], IpWhoisCard)],
    streamed: true,
    fetcher: fromStream('ip-whois'),
    retryFetcher: fetchAndRetry('ip-whois?url=${ip}'),
  },
  {
    id: 'asn',
    needsIp: true,
    cards: [card('asn', 'ASN & Peering', ['server', 'meta'], AsnCard)],
    streamed: true,
    fetcher: fromStream('asn'),
    retryFetcher: fetchAndRetry('asn?url=${ip}'),
  },
  {
    id: 'org-asns',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('org-asns', 'Organization ASNs', ['server', 'meta'], OrgAsnsCard)],
    streamed: true,
    fetcher: fromStream('org-asns'),
    retryFetcher: fetchAndRetry('org-asns?url=${url}'),
  },
  {
    id: 'txt-records',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('txt-records', 'TXT Records', ['server'], TxtRecordCard)],
    fetcher: clientTxtRecords,
  },
  {
    id: 'block-lists',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('block-lists', 'Block Lists', ['security', 'meta'], BlockListsCard)],
    streamed: true,
    fetcher: fromStream('block-lists'),
    retryFetcher: fetchAndProcess('block-lists?url=${url}'),
  },
  {
    id: 'sitemap',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('sitemap', 'Pages', ['meta'], SitemapCard)],
    streamed: true,
    fetcher: fromStream('sitemap'),
    retryFetcher: fetchAndProcess('sitemap?url=${url}'),
  },
  {
    id: 'screenshot',
    expectedAddressTypes: [...URL_ONLY],
    cards: [
      card('screenshot', 'Screenshot', ['client', 'meta'], ScreenshotCard, {
        fallback: (state: JobsState) => state.quality?.raw?.fullPageScreenshot?.screenshot,
      }),
    ],
    fetcher: clientScreenshot,
  },
  {
    id: 'social-tags',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('social-tags', 'Social Tags', ['client', 'meta'], SocialTagsCard)],
    streamed: true,
    fetcher: fromStream('social-tags'),
    retryFetcher: fetchAndProcess('social-tags?url=${url}'),
  },
  {
    id: 'carbon',
    expectedAddressTypes: [...URL_ONLY],
    cards: [card('carbon', 'Carbon Footprint', ['meta'], CarbonFootprintCard)],
    streamed: true,
    fetcher: fromStream('carbon'),
    retryFetcher: fetchAndProcess('carbon?url=${url}'),
  },
];

// Flat list of every card id (1+ per job). Used by ProgressBar and the result grid
export const allCardIds: string[] = jobs.flatMap((j) => j.cards.map((c) => c.id));

export const allCards: Array<{ jobId: string; card: JobSpec['cards'][number] }> = jobs.flatMap(
  (j) => j.cards.map((card) => ({ jobId: j.id, card })),
);
