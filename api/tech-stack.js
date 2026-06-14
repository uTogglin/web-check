import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';
import { detectTech } from './_common/tech-detect.js';

// Fingerprint the site's stack without a browser: fetch the page once, then
// match Wappalyzer's bundled signature database against the response headers,
// cookies, meta tags, script srcs, HTML and URL. No Chromium required — so this
// runs anywhere and keeps the deploy image tiny. The only thing lost versus a
// headless-browser pass is detection that depends on runtime-executed JS.
const detectFromHttp = async (url) => {
  const response = await httpGet(url, {
    validateStatus: (status) => status >= 200 && status < 600,
  });
  const cookies = {};
  for (const raw of response.headers?.['set-cookie'] || []) {
    const pair = String(raw).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return detectTech({
    url,
    html: typeof response.data === 'string' ? response.data : '',
    headers: response.headers || {},
    cookies,
  });
};

const techStackHandler = async (url) => {
  const technologies = await detectFromHttp(url).catch(() => []);
  if (!technologies.length) {
    return { skipped: 'Unable to detect any technologies for this site' };
  }
  return { technologies };
};

export const handler = middleware(techStackHandler);
export default handler;
