// Single-request scan streaming.
//
// A scan runs ~33 server-side checks. Rather than firing one HTTP request per
// check, we open ONE streaming request to /api/scan and let modules subscribe
// to individual results by name. The backend emits NDJSON: one
// `{"check":"<name>","body":<object>}` line per check as it resolves.
//
// All subscribers sharing a scanKey share that one fetch. The fetch opens
// lazily on the first subscribe for a given scanKey (so it inherits that
// call's url + ip), and per-scanKey state is torn down when the stream ends or
// the scan aborts.

import { getApiAuthHeaders, clearApiAuth } from 'client/utils/api-auth';

export interface ScanStreamCtx {
  api: string;            // base, e.g. "/api"
  address: string;        // target url/host
  ipAddress?: string;     // resolved IP for ip-keyed checks (may be undefined)
  scanKey: number;        // identifies this scan run
  scanSignal: AbortSignal;// scan-level abort (separate from per-job signals)
}

interface PendingResolver {
  resolve: (body: any) => void;
  reject: (err: any) => void;
}

interface ScanState {
  started: boolean;
  // Set once the stream has finished (normally or via auth failure). A late
  // first-subscriber for an ended scan must NOT reopen the request — it reads
  // the cached body (or "missing") instead, preserving the one-request-per-scan
  // guarantee even when a client check (whois) subscribes after a slow fast-path.
  ended: boolean;
  // Bodies already received, so a late subscriber resolves immediately.
  received: Map<string, any>;
  // Subscribers waiting for a line that hasn't arrived yet.
  pending: Map<string, PendingResolver>;
  // Detaches the scanSignal abort listener on teardown (avoids leaking on the
  // shared signal, which may outlive this scan). Undefined until started.
  scanSignalRemove?: () => void;
}

// Module-level state, one entry per in-flight scan run.
const scans = new Map<number, ScanState>();

// AbortError matching the shape browsers produce from fetch aborts.
const abortError = (): DOMException => new DOMException('aborted', 'AbortError');

// Resolve every pending subscriber for a scan with the "no result" sentinel.
// Used when the stream ends without ever emitting a line for a check, so
// callers don't hang forever.
const drainPendingAsMissing = (state: ScanState): void => {
  for (const [, resolver] of state.pending) {
    resolver.resolve({ error: 'No result from scan stream' });
  }
  state.pending.clear();
};

// Mark a scan finished and stop listening for aborts, but KEEP its state (and
// `received` cache) so a late first-subscriber resolves without reopening the
// request. Stale ended scans are pruned when the next scan starts.
const endScan = (state: ScanState): void => {
  state.ended = true;
  state.scanSignalRemove?.();
  state.scanSignalRemove = undefined;
};

// Reject every pending subscriber, then mark the scan ended.
const failScan = (scanKey: number, err: any): void => {
  const state = scans.get(scanKey);
  if (!state) return;
  for (const [, resolver] of state.pending) resolver.reject(err);
  state.pending.clear();
  endScan(state);
};

// Drop every ended scan except the current one (bounds the map to live scans).
const pruneEnded = (keepKey: number): void => {
  for (const [key, state] of scans) {
    if (key !== keepKey && state.ended) scans.delete(key);
  }
};

// Hand a freshly-received body to whoever is waiting (or cache it for a future
// late subscriber).
const deliver = (state: ScanState, check: string, body: any): void => {
  state.received.set(check, body);
  const resolver = state.pending.get(check);
  if (resolver) {
    state.pending.delete(check);
    resolver.resolve(body);
  }
};

// Consume the NDJSON stream: split on newlines, JSON.parse each complete line,
// route `{check, body}` to subscribers. Cleans up the scanKey when done.
const pump = async (scanKey: number, ctx: ScanStreamCtx): Promise<void> => {
  let res: Response;
  try {
    res = await fetch(
      `${ctx.api}/scan?url=${encodeURIComponent(ctx.address)}` +
        (ctx.ipAddress ? `&ip=${encodeURIComponent(ctx.ipAddress)}` : ''),
      {
        headers: await getApiAuthHeaders(),
        credentials: 'include',
        signal: ctx.scanSignal,
      },
    );
  } catch (err) {
    // Includes the AbortError thrown when scanSignal fires during connect.
    failScan(scanKey, err);
    return;
  }

  // A 403 means our session was rejected (e.g. expired mid-scan): clear it so
  // the next scan re-solves Turnstile, and fail everyone waiting on this one.
  if (res.status === 403) {
    clearApiAuth();
    failScan(scanKey, new Error('Scan auth rejected'));
    return;
  }

  const state = scans.get(scanKey);
  if (!state || !res.body) {
    if (state) failScan(scanKey, new Error('Scan stream unavailable'));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return; // skip blank lines
    try {
      const msg = JSON.parse(trimmed) as { check: string; body: any };
      if (msg && typeof msg.check === 'string') deliver(state, msg.check, msg.body);
    } catch {
      // Ignore unparseable lines rather than killing the whole stream.
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    // Flush any trailing partial line at end of stream.
    handleLine(buffer + decoder.decode());
  } catch (err) {
    // Abort during read surfaces here; treat any read failure as scan failure.
    failScan(scanKey, ctx.scanSignal.aborted ? abortError() : err);
    return;
  }

  // Stream ended normally: anyone still waiting never got a line.
  drainPendingAsMissing(state);
  endScan(state);
};

/**
 * Subscribe to one check's result by name. Resolves with that check's `body`
 * once its NDJSON line arrives (or immediately, if the line already arrived).
 * Rejects with an AbortError if scanSignal aborts before the line is received.
 *
 * The first call for a given scanKey lazily opens the shared /api/scan fetch.
 */
export const subscribeToScan = (ctx: ScanStreamCtx, check: string): Promise<any> => {
  // Bail out fast if the scan is already cancelled.
  if (ctx.scanSignal.aborted) return Promise.reject(abortError());

  let state = scans.get(ctx.scanKey);

  // The stream for this scan already finished. Resolve from the cache (or as
  // "missing") rather than reopening a second /api/scan request.
  if (state?.ended) {
    return Promise.resolve(
      state.received.has(check) ? state.received.get(check) : { error: 'No result from scan stream' },
    );
  }

  if (!state) {
    pruneEnded(ctx.scanKey); // a new scan started; forget prior ended scans
    state = {
      started: false,
      ended: false,
      received: new Map(),
      pending: new Map(),
      scanSignalRemove: undefined,
    };
    scans.set(ctx.scanKey, state);
  }

  // Already received this check's body before we subscribed: resolve now.
  if (state.received.has(check)) return Promise.resolve(state.received.get(check));

  const promise = new Promise<any>((resolve, reject) => {
    state!.pending.set(check, { resolve, reject });
  });

  // Open the shared request on the first subscribe for this scanKey.
  if (!state.started) {
    state.started = true;

    const onAbort = () => {
      // Reject everyone still waiting and end the scan; the fetch itself is
      // aborted by the browser via the signal we passed it. Later subscribes on
      // this (now-aborted) signal reject at the top of subscribeToScan.
      const s = scans.get(ctx.scanKey);
      if (!s) return;
      for (const [, resolver] of s.pending) resolver.reject(abortError());
      s.pending.clear();
      endScan(s);
    };
    ctx.scanSignal.addEventListener('abort', onAbort, { once: true });
    state.scanSignalRemove = () => ctx.scanSignal.removeEventListener('abort', onAbort);

    // Fire and forget; pump() owns all teardown for this scanKey.
    void pump(ctx.scanKey, ctx);
  }

  return promise;
};
