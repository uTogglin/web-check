import psl from 'psl';
import * as cheerio from 'cheerio';
import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { parseTarget } from './_common/parse-target.js';

// Known third-party services: [hostname pattern, provider, category].
// Ordered most-specific first; first match wins.
const KNOWN = [
  // Analytics
  [/google-analytics\.com|analytics\.google\.com|googletagmanager\.com/, 'Google Analytics / GTM', 'analytics'],
  [/clarity\.ms/, 'Microsoft Clarity', 'analytics'],
  [/hotjar\.com/, 'Hotjar', 'analytics'],
  [/mixpanel\.com/, 'Mixpanel', 'analytics'],
  [/amplitude\.com/, 'Amplitude', 'analytics'],
  [/segment\.(com|io)/, 'Segment', 'analytics'],
  [/cloudflareinsights\.com/, 'Cloudflare Analytics', 'analytics'],
  [/plausible\.io/, 'Plausible', 'analytics'],
  [/matomo|piwik/, 'Matomo', 'analytics'],
  [/yandex\.(ru|com)|mc\.yandex/, 'Yandex Metrica', 'analytics'],
  // Advertising
  [/doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google/, 'Google Ads', 'advertising'],
  [/amazon-adsystem\.com/, 'Amazon Ads', 'advertising'],
  [/bat\.bing\.com|bing\.com\/bat/, 'Microsoft Ads', 'advertising'],
  [/criteo\.(com|net)/, 'Criteo', 'advertising'],
  [/taboola\.com/, 'Taboola', 'advertising'],
  [/outbrain\.com/, 'Outbrain', 'advertising'],
  [/adroll\.com/, 'AdRoll', 'advertising'],
  [/adnxs\.com/, 'AppNexus', 'advertising'],
  // Social (also used for ad retargeting)
  [/connect\.facebook\.net|facebook\.com\/tr/, 'Meta Pixel', 'social'],
  [/ads-twitter\.com|t\.co|static\.ads-twitter/, 'X / Twitter', 'social'],
  [/licdn\.com|linkedin\.com/, 'LinkedIn', 'social'],
  [/tiktok\.com|tiktokcdn/, 'TikTok', 'social'],
  [/pinterest\.com|pinimg\.com/, 'Pinterest', 'social'],
  [/snapchat\.com|sc-static\.net/, 'Snapchat', 'social'],
  // Tag / consent managers
  [/onetrust\.com|cookielaw\.org/, 'OneTrust', 'consent'],
  [/cookiebot\.com/, 'Cookiebot', 'consent'],
  // Session recording / A-B testing
  [/fullstory\.com/, 'FullStory', 'session-recording'],
  [/mouseflow\.com/, 'Mouseflow', 'session-recording'],
  [/optimizely\.com/, 'Optimizely', 'ab-testing'],
  [/vwo\.com|visualwebsiteoptimizer/, 'VWO', 'ab-testing'],
  // Marketing automation
  [/hubspot\.com|hs-scripts\.com|hs-analytics\.net|hsforms/, 'HubSpot', 'marketing'],
  [/marketo\.(com|net)|mktoresp/, 'Marketo', 'marketing'],
  [/pardot\.com/, 'Pardot', 'marketing'],
  // Error / performance monitoring
  [/sentry\.io|sentry-cdn/, 'Sentry', 'monitoring'],
  [/newrelic\.com|nr-data\.net/, 'New Relic', 'monitoring'],
  [/bugsnag\.com/, 'Bugsnag', 'monitoring'],
  [/datadoghq\.com|datad0g/, 'Datadog', 'monitoring'],
  // Support / chat
  [/intercom\.io|intercomcdn\.com/, 'Intercom', 'support'],
  [/zendesk\.com|zdassets\.com|zopim/, 'Zendesk', 'support'],
  [/drift\.com/, 'Drift', 'support'],
  // Utility (non-tracking)
  [/fonts\.(googleapis|gstatic)\.com/, 'Google Fonts', 'fonts'],
  [/use\.typekit|fonts\.net|fontawesome/, 'Web Fonts', 'fonts'],
  [/youtube(-nocookie)?\.com|ytimg\.com|vimeo\.com|vimeocdn/, 'Video Embed', 'media'],
  [/stripe\.(com|network)/, 'Stripe', 'payments'],
  [/paypal\.com|paypalobjects/, 'PayPal', 'payments'],
  [/recaptcha|hcaptcha\.com/, 'CAPTCHA', 'security'],
  [/cloudfront\.net|akamai(hd)?\.net|fastly\.net|jsdelivr\.net|cdnjs|unpkg\.com|cdn\.cloudflare/, 'CDN', 'cdn'],
];

// Categories that represent user tracking (vs. plain utility/CDN)
const TRACKING_CATEGORIES = new Set([
  'analytics',
  'advertising',
  'social',
  'session-recording',
  'ab-testing',
  'marketing',
  'consent',
]);

const classify = (host) => {
  const found = KNOWN.find(([re]) => re.test(host));
  return found ? { provider: found[1], category: found[2] } : { provider: null, category: 'other' };
};

const registrable = (host) => psl.parse(host)?.domain || host;

// Browserless scan: fetch the page HTML and inspect every external resource it
// statically references (scripts, stylesheets, images, iframes, media, and
// preconnect/dns-prefetch hints). This can't see resources a page injects at
// runtime via JS the way a headless browser would, but it reliably surfaces the
// embedded trackers, pixels, fonts and CDNs that sit directly in the markup.
const collectStaticHosts = async (targetUrl) => {
  const response = await httpGet(targetUrl, {
    validateStatus: (status) => status >= 200 && status < 600,
  });
  const html = typeof response.data === 'string' ? response.data : '';
  const $ = cheerio.load(html);

  const refs = [];
  const add = (sel, attr) =>
    $(sel).each((_, el) => {
      const v = $(el).attr(attr);
      if (v) refs.push(v);
    });
  add('script[src]', 'src');
  add('link[href]', 'href'); // stylesheets, preconnect, dns-prefetch, icons, fonts
  add('img[src]', 'src');
  add('iframe[src]', 'src');
  add('source[src]', 'src');

  const setCookies = response.headers?.['set-cookie'] || [];

  const hosts = [];
  for (const ref of refs) {
    try {
      hosts.push(new URL(ref, targetUrl).hostname);
    } catch {
      /* ignore relative paths and non-parseable URLs (data:, about:, etc.) */
    }
  }
  return { hosts, firstPartyCookieCount: setCookies.length };
};

const thirdPartyHandler = async (targetUrl) => {
  const { hostname } = parseTarget(targetUrl);
  const firstParty = registrable(hostname);

  let data;
  try {
    data = await collectStaticHosts(targetUrl);
  } catch (error) {
    return { error: `Third-party scan failed: ${error.message}` };
  }

  // Aggregate third-party references by registrable domain
  const byDomain = new Map();
  let totalRequests = 0;
  for (const host of data.hosts) {
    totalRequests += 1;
    const domain = registrable(host);
    if (!domain || domain === firstParty) continue;
    if (!byDomain.has(domain)) {
      byDomain.set(domain, { domain, count: 0, ...classify(host) });
    }
    byDomain.get(domain).count += 1;
  }

  const thirdPartyDomains = [...byDomain.values()].sort((a, b) => b.count - a.count);
  if (!thirdPartyDomains.length) {
    return { skipped: 'No third-party resources referenced in the page markup' };
  }

  const categories = thirdPartyDomains.reduce((acc, d) => {
    acc[d.category] = (acc[d.category] || 0) + 1;
    return acc;
  }, {});

  const trackerCount = thirdPartyDomains.filter((d) =>
    TRACKING_CATEGORIES.has(d.category),
  ).length;

  return {
    url: targetUrl,
    firstPartyDomain: firstParty,
    totalRequests,
    thirdPartyRequests: thirdPartyDomains.reduce((n, d) => n + d.count, 0),
    thirdPartyDomainCount: thirdPartyDomains.length,
    trackerCount,
    categories,
    // Set-Cookie headers are first-party by definition; third-party cookies can
    // only be observed with a real browser, so report 0 rather than guess.
    cookies: { firstParty: data.firstPartyCookieCount, thirdParty: 0 },
    thirdPartyDomains,
  };
};

export const handler = middleware(thirdPartyHandler);
export default handler;
