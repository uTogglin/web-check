import middleware from './_common/middleware.js';
import { httpGet } from './_common/http.js';

// Header (Set-Cookie) cookie inspection. Reading cookies a page sets later via
// client-side JavaScript would need a headless browser, which Web-Check no
// longer runs — but Set-Cookie headers cover the large majority of cookies, and
// the analyzer only audits those for Secure/HttpOnly/SameSite anyway.
const cookieHandler = async (url) => {
  let headerCookies = null;
  try {
    const response = await httpGet(url);
    headerCookies = response.headers['set-cookie'];
  } catch (error) {
    if (error.response) {
      return { error: `Request failed with status ${error.response.status}: ${error.message}` };
    }
    return { error: `No response received: ${error.message}` };
  }

  return {
    headerCookies: headerCookies || [],
    clientCookies: [],
  };
};

export const handler = middleware(cookieHandler);
export default handler;
