// Canonical rate-limit copy, shared by every path that can receive a 429
// (per-check fetches, the scan stream, and the auth exchange) so the user sees
// the same message wherever a limit is hit.
export const RATE_LIMIT_MESSAGE = 'Rate limited, try again later';

const STATUS_MESSAGES: Record<number, string> = {
  408: 'Request timed out',
  429: RATE_LIMIT_MESSAGE,
  500: 'Internal server error',
  502: 'Bad gateway, upstream server failed',
  503: 'Service temporarily unavailable',
  504: 'Gateway timed out',
};

const FALLBACK = 'API request failed. This may be a server error, timeout, or platform limitation.';

// Build the rate-limit message for a 429, honoring a Retry-After header when the
// edge supplies one. It often can't (e.g. Cloudflare's free tier can't rewrite
// the rate-limit response/header), so we fall back to the generic copy.
export const rateLimitMessage = (res?: Response): string => {
  const retryAfter = res?.headers?.get?.('Retry-After') ?? res?.headers?.get?.('RateLimit-Reset');
  const secs = retryAfter ? parseInt(retryAfter, 10) : NaN;
  return Number.isFinite(secs) && secs > 0
    ? `Rate limited, try again in ${secs} seconds`
    : RATE_LIMIT_MESSAGE;
};

// Decode a fetch Response as JSON, returning a structured error on failure
export const parseJson = async (res: Response): Promise<any> => {
  const statusFor = (r: Response) =>
    r.status === 429 ? rateLimitMessage(r) : STATUS_MESSAGES[r.status];
  try {
    const json = await res.json();
    if (!res.ok && !json?.error) {
      const detail = json?.errorMessage || json?.message;
      const statusMsg = statusFor(res) || `${FALLBACK} (HTTP ${res.status})`;
      return { error: detail ? `${statusMsg} - ${detail}` : statusMsg };
    }
    return json;
  } catch {
    const statusMsg = statusFor(res) || FALLBACK;
    return { error: `${statusMsg} (HTTP ${res.status})` };
  }
};

export default parseJson;
