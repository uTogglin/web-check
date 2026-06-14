import { execFile } from 'child_process';
import os from 'os';
import middleware from './_common/middleware.js';
import { parseTarget } from './_common/parse-target.js';

const isWindows = os.platform() === 'win32';
// Windows tracert sends 3 probes per hop and has no single-probe flag, so it
// needs a longer budget than the lean unix `traceroute -q 1`.
const LOCAL_TIMEOUT = isWindows ? 30000 : 8000;

// Parse unix `traceroute -n` output into [{ip, times}], skipping unanswered hops
const parseUnixHops = (stdout) => {
  const hops = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*\d+\s+([\d.]+|\S*::\S*)\s+([\d.]+)\s*ms/);
    if (m) hops.push({ ip: m[1], times: [Number(m[2])] });
  }
  return hops;
};

// Parse Windows `tracert -d` output. Lines look like:
//   `  3    10 ms    11 ms     9 ms  142.250.1.1`  (or `*` for timed-out probes)
const parseWindowsHops = (stdout) => {
  const hops = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*\d+\s+(.*\S)\s*$/);
    if (!m) continue;
    const rest = m[1];
    const ip = rest.match(/\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]+/i)?.[0];
    if (!ip) continue; // "Request timed out." — no answered probe
    // `<1 ms` is reported for sub-millisecond hops; treat as 1ms
    const times = [...rest.matchAll(/<?\s*(\d+)\s*ms/gi)].map((t) => Number(t[1]));
    hops.push({ ip, times: times.length ? times : [0] });
  }
  return hops;
};

// Run the system trace binary via execFile (no shell, no injection)
const runTraceroute = (host) =>
  new Promise((resolve, reject) => {
    const cmd = isWindows ? 'tracert' : 'traceroute';
    const args = isWindows
      ? ['-d', '-h', '20', '-w', '1000', host]
      : ['-q', '1', '-n', '-w', '2', host];
    const parse = isWindows ? parseWindowsHops : parseUnixHops;
    execFile(cmd, args, { timeout: LOCAL_TIMEOUT, windowsHide: true }, (err, stdout) => {
      const hops = parse(stdout || '');
      // If we timed out mid-trace but already captured hops, return them anyway
      if (err && !hops.length) return reject(err);
      resolve(hops);
    });
  });

const isMissingBinary = (err) =>
  err?.code === 'ENOENT' || /command not found|not installed/i.test(err?.message || '');

const traceRouteHandler = async (url) => {
  const start = Date.now();
  const { hostname } = parseTarget(url);
  let hops;
  try {
    hops = await runTraceroute(hostname);
  } catch (err) {
    if (isMissingBinary(err)) {
      return {
        skipped:
          'Traceroute is not installed in this environment. ' +
          'Install via your package manager, or run web-check via Docker.',
      };
    }
    return { error: `Traceroute failed: ${err.message}` };
  }
  if (!hops.length) {
    return { skipped: 'Traceroute returned no answered hops for this host' };
  }
  return {
    message: 'Traceroute completed!',
    result: hops.map(({ ip, times }) => ({ [ip]: times })),
    timeTaken: Date.now() - start,
  };
};

export const handler = middleware(traceRouteHandler);
export default handler;
