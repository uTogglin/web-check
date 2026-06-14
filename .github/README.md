<h1 align="center">Web-Check</h1>

<p align="center">
<img src="https://cdn.as93.net/logo/web-check/w256" width="96" /><br />
<b><i>Comprehensive, on-demand open source intelligence for any website</i></b>
<br />
</p>

---

## About

Point Web-Check at any website and get an instant, in-depth picture of how it's
built, hosted and secured: IP and ASN ownership, the full SSL/TLS chain, DNS and
mail records, security headers, cookies, open ports, the technology stack,
trackers, performance, carbon footprint and much more — all on one dashboard, no
sign-up required.

> **This fork.** This is a maintained fork of the excellent
> [lissy93/web-check](https://github.com/lissy93/web-check) by
> [Alicia Sykes](https://aliciasykes.com). It keeps every original check and adds
> a handful of new ones, but is re-architected to run **without a headless
> browser** and to offload as much work as possible to the visitor's own
> browser. The result is dramatically cheaper and simpler to self-host: it fits
> comfortably on a 256&nbsp;MB machine and a free serverless tier. See
> [What's different in this fork](#whats-different-in-this-fork) for the details.

The aim is to help you easily understand, optimise and secure your website.

---

## What's different in this fork

This fork is functionally a superset of upstream, with three structural changes
that make it far lighter to run.

### 1. No headless browser, anywhere

Upstream bundled Chromium (via Puppeteer / `@sparticuz/chromium`) to render pages
for screenshots and JavaScript-based technology detection. That meant a ~280&nbsp;MB
browser download on install, a heavyweight Docker image, and ~1&nbsp;GB of RAM at
runtime. All of it is gone:

- **`puppeteer`, `puppeteer-core`, `chromium` and `@sparticuz/chromium` removed**
  from `package.json`. `.npmrc` defensively skips any transitive Chromium
  download (Wappalyzer still pulls Puppeteer in as a dependency).
- **Technology detection is now browserless** (`api/_common/tech-detect.js`).
  Wappalyzer's fingerprint database is matched directly against the page's raw
  HTML, response headers, cookies, meta tags and script sources. This is fast,
  works everywhere, and needs no binary.
- **Screenshots are captured via [Microlink](https://microlink.io/)'s** hosted,
  CORS-enabled screenshot API, called directly from the client.
- **The Dockerfile no longer installs Chrome/Chromium**, and the Fly.io machine
  is sized down from **1&nbsp;GB → 256&nbsp;MB RAM** (with 512&nbsp;MB of swap as
  a safety margin while the in-memory fingerprint DB loads).

### 2. Many checks now run in the visitor's browser

Several checks that used to round-trip through serverless functions now execute
client-side against public, CORS-enabled APIs — chiefly **DNS-over-HTTPS** (Google
& Cloudflare, with automatic failover). Each client implementation mirrors the
exact response shape of the endpoint it replaces, so cards and analysers consume
it unchanged.

This moves work off your infrastructure entirely: **zero function invocations**
for these checks, faster results (no extra server hop), and lower hosting costs.
The endpoints below were deleted from `/api` and reimplemented in
`src/client/jobs/client-checks.ts` (with DoH helpers in
`src/client/utils/doh.ts`):

`get-ip` · `location` · `dns` · `dnssec` · `txt-records` · `mail-config` ·
`screenshot`

### 3. New checks

Seven additional checks ship in this fork, each with its own dashboard card:

| Check | What it shows |
| ----- | ------------- |
| **CAA Records** | Which certificate authorities are authorised to issue for the domain |
| **Certificate Transparency** | Certificates logged in public CT logs, including recently-issued ones |
| **Email Security** | SPF, DKIM and DMARC policy, resolved over DoH |
| **Third-Party Trackers** | Third-party scripts and services embedded in the page, classified by provider/category |
| **IP WHOIS** | Registration and network details for the resolved IP |
| **ASN & Peering** | The autonomous system the IP lives in, plus its neighbours and prefixes |
| **Organization ASNs** | All ASNs registered to the organisation behind the domain |

---

## Features

Web-Check runs each of the following checks and renders the results as a card on
the dashboard. Checks that depend on an optional API key are skipped gracefully
when the key isn't set.

- **IP Info** — resolved IPv4/IPv6 address for the host
- **SSL Chain** — full certificate chain, validity and issuer
- **DNS Records** — A, AAAA, MX, TXT, NS, CNAME, SOA, SRV and more
- **Cookies** — cookies set by the site, with their flags
- **Crawl Rules** — `robots.txt` directives
- **Headers** — full set of HTTP response headers
- **Quality** — Lighthouse-style performance, accessibility & SEO metrics
- **Server Location** — geographic location of the hosting server
- **Associated Hostnames** — other hostnames linked to the site
- **Redirects** — the full redirect ledger for the URL
- **TXT Records** — raw DNS TXT entries
- **Server Status** — uptime / reachability
- **Open Ports** — commonly-open ports on the host
- **Traceroute** — network path to the server
- **Carbon Footprint** — estimated CO₂ cost of loading the page
- **Server Info** — hosting provider and infrastructure details
- **Whois** — domain registration record
- **Domain Info** — registrar, dates and nameservers
- **DNS Security (DNSSEC)** — DNSSEC extension status
- **Site Features** — detected capabilities of the site
- **HTTP Security** — security headers audit (HSTS, CSP, etc.)
- **DNS Server** — resolver and DoH support
- **Tech Stack** — frameworks, libraries and services in use (browserless)
- **Listed Pages** — sitemap / page map
- **Security.txt** — published security disclosure policy
- **Linked Pages** — internal and external links
- **Social Tags** — Open Graph / Twitter card metadata
- **Mail Config** — mail server configuration
- **HSTS Check** — HSTS preload eligibility
- **Screenshot** — visual capture of the page (via Microlink)
- **TLS Security** — cipher suites, connection and client-compatibility audits
- **Rank** — global traffic rank (Tranco)
- **Block Lists** — presence on common block/threat lists
- **Threats** — known malware/phishing associations
- **Trackers** — analytics and advertising trackers
- 🆕 **CAA Records**, **Certificate Transparency**, **Email Security**,
  **Third-Party Trackers**, **IP WHOIS**, **ASN & Peering**, **Organization ASNs**

---

## Usage

### Deployment

Because there's no browser to install, every deployment path is lighter than
upstream. Pick whichever suits you.

#### Option #1: Docker

```bash
docker run -p 3000:3000 ghcr.io/utogglin/web-check
```

Or build it yourself from the included `Dockerfile`:

```bash
docker build -t web-check .
docker run -p 3000:3000 web-check
```

#### Option #2: From Source

```bash
git clone https://github.com/uTogglin/web-check.git
cd web-check
yarn          # install dependencies
yarn build    # build the app
yarn start    # serve it
```

#### Option #3: Netlify / Vercel / Fly.io

The repo ships with `netlify.toml`, a serverless-ready `/api` directory, and a
`fly.toml` pre-sized for a single 256&nbsp;MB shared-CPU machine. Connect the
repository to your platform of choice and deploy — no extra configuration is
required.

### Configuring

By default, **no configuration is needed**. Optional environment variables unlock
extra checks or raise rate limits on the external APIs some checks use.

**API keys & credentials** (all optional):

| Key                        | Effect                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| `GOOGLE_CLOUD_API_KEY`     | Enables quality / performance metrics                                      |
| `REACT_APP_SHODAN_API_KEY` | Shows associated hostnames for a domain                                    |
| `REACT_APP_WHO_API_KEY`    | Richer WHOIS records than the default check                                |
| `SECURITY_TRAILS_API_KEY`  | Org info associated with the IP                                            |
| `TRANCO_USERNAME` / `TRANCO_API_KEY` | Traffic-rank data                                                |
| `URL_SCAN_API_KEY`         | Miscellaneous URLScan info                                                 |

**Configuration settings** (all optional):

| Key                        | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `PORT`                     | Port to serve on when running `server.js` (e.g. `3000`)                    |
| `API_ENABLE_RATE_LIMIT`    | Enable rate-limiting on `/api`                                             |
| `PUBLIC_API_TIMEOUT_LIMIT` | Per-request timeout in ms (e.g. `25000`)                                   |
| `API_CORS_ORIGIN`          | Allowed CORS origin(s)                                                     |
| `DISABLE_GUI`              | Serve only the API, no GUI                                                 |
| `REACT_APP_API_ENDPOINT`   | API endpoint, local or remote (e.g. `/api`)                                |

> Note: `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` are **no longer used** — this
> fork runs no browser. Keys prefixed with `REACT_APP_` are exposed client-side,
> so scope them with minimum privileges.

Set these in a `.env` file in the project root, via your platform's UI, or by
passing `--env` flags to Docker.

### Developing

```bash
git clone https://github.com/uTogglin/web-check.git
cd web-check
yarn        # install dependencies
yarn dev    # start the dev server
```

You'll need [Node.js](https://nodejs.org/en) 18.16.1+ and
[yarn](https://yarnpkg.com/getting-started/install). `traceroute` is used by one
optional check and is skipped if not present. **No `chromium` install is
required.**

---

## Credits & License

This project is a fork of **[lissy93/web-check](https://github.com/lissy93/web-check)**,
created and maintained by **[Alicia Sykes](https://aliciasykes.com)**. All credit
for the original application, its design and the bulk of its checks belongs to her
and the upstream contributors. Please consider
[supporting the original project](https://github.com/sponsors/Lissy93).

Licensed under **[MIT](https://github.com/lissy93/web-check/blob/HEAD/LICENSE)** ©
[Alicia Sykes](https://aliciasykes.com) 2023–2026.

```
The MIT License (MIT)
Copyright (c) Alicia Sykes <alicia@omg.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sub-license, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
