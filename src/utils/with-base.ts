// Prefix a path with the site's deploy base (e.g. '/web-check/' on GitHub Pages,
// '/' at root). Astro exposes import.meta.env.BASE_URL WITHOUT a trailing slash,
// so we normalise to exactly one trailing slash before joining. Use this for any
// hand-written link to a public asset or internal page so it survives sub-path
// hosting. (Astro's own bundled assets and react-router <Link>s are handled
// automatically and don't need this.)
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export const withBase = (path = ''): string => BASE + path.replace(/^\//, '');
