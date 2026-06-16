// Client-side bot protection for API requests.
//
// A scan fires many parallel requests, but a Turnstile token is single-use. So
// we solve Turnstile ONCE, exchange it for a short-lived session token at the
// /auth endpoint, and attach that token to every API request. Concurrent
// callers share a single in-flight solve+exchange via `inflight`.
//
// When PUBLIC_TURNSTILE_SITE_KEY is unset, this is a no-op: getApiAuthHeaders()
// returns {} and the API is called exactly as before.

const SITE_KEY = (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string) || '';
const apiBase = (import.meta.env.PUBLIC_API_ENDPOINT || '/api') as string;

// Token-exchange endpoint. Defaults to the API origin's /auth path, derived
// from PUBLIC_API_ENDPOINT; override with PUBLIC_API_AUTH_ENDPOINT.
const AUTH_ENDPOINT =
  (import.meta.env.PUBLIC_API_AUTH_ENDPOINT as string) || apiBase.replace(/\/api\/?$/, '/auth');

// Header the session token is sent in.
const SESSION_HEADER = 'X-Wc-Session';

// Refresh a little before the real expiry to avoid races on long scans.
const EXPIRY_SKEW_MS = 30_000;

interface Turnstile {
  ready: (cb: () => void) => void;
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let cached: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;
let scriptPromise: Promise<void> | null = null;
let widgetId: string | null = null;
let container: HTMLElement | null = null;

const loadScript = (): Promise<void> => {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(s);
  });
  return scriptPromise;
};

// Render an invisible widget once, then execute it each time we need a fresh
// Turnstile token. Resolves with the token Cloudflare hands to the callback.
const solveTurnstile = (): Promise<string> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const onToken = (token: string) => {
      if (settled) return;
      settled = true;
      resolve(token);
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Turnstile challenge failed'));
    };

    window.turnstile!.ready(() => {
      try {
        if (widgetId === null) {
          container = document.createElement('div');
          container.style.position = 'fixed';
          container.style.bottom = '0';
          container.style.right = '0';
          container.style.zIndex = '2147483647';
          document.body.appendChild(container);
          widgetId = window.turnstile!.render(container, {
            sitekey: SITE_KEY,
            size: 'invisible',
            callback: onToken,
            'error-callback': onError,
            'timeout-callback': onError,
          });
        } else {
          window.turnstile!.reset(widgetId);
        }
        window.turnstile!.execute(widgetId);
      } catch (err) {
        onError();
      }
    });
  });

const obtainSessionToken = async (): Promise<string> => {
  await loadScript();
  const turnstileToken = await solveTurnstile();
  const res = await fetch(AUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: turnstileToken }),
  });
  if (!res.ok) throw new Error('Could not verify you are human (Turnstile rejected)');
  const data = await res.json();
  if (!data?.token) throw new Error('Auth endpoint returned no session token');
  cached = { token: data.token, exp: Date.now() + (data.expiresIn ?? 900) * 1000 };
  return cached.token;
};

const getSessionToken = (): Promise<string> => {
  if (cached && cached.exp - EXPIRY_SKEW_MS > Date.now()) return Promise.resolve(cached.token);
  if (inflight) return inflight;
  inflight = obtainSessionToken().finally(() => {
    inflight = null;
  });
  return inflight;
};

/**
 * Headers to merge into every request that targets our own API. Returns an
 * empty object (and triggers no Turnstile) when no site key is configured.
 */
export const getApiAuthHeaders = async (): Promise<Record<string, string>> => {
  if (!SITE_KEY) return {};
  const token = await getSessionToken();
  return { [SESSION_HEADER]: token };
};

// Drop the cached session so the next request re-solves Turnstile. Call this
// when the API answers 403, in case the session expired mid-scan.
export const clearApiAuth = (): void => {
  cached = null;
};
