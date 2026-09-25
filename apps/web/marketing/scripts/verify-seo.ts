import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Window } from 'happy-dom';
import baseline from '../seo/migration-baseline.json';

const directory = path.resolve(import.meta.dirname, '../../dist-site');
const origin = (process.env.VITE_APP_BASE_URL || 'https://macro.com').replace(
  /\/$/,
  ''
);
const window = new Window();
const parse = (html: string) =>
  new window.DOMParser().parseFromString(html, 'text/html');
const sitemap = fs.readFileSync(path.join(directory, 'sitemap.xml'), 'utf8');
const routes = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(
  (match) => new URL(match[1]).pathname
);
const htmlFor = (route: string) =>
  fs.readFileSync(path.join(directory, route.slice(1), 'index.html'), 'utf8');
const typesIn = (html: string) =>
  [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);

const linksByRoute = new Map<string, string[]>();
const documentsByRoute = new Map<string, ReturnType<typeof parse>>();
for (const previous of baseline.routes) {
  assert(
    routes.includes(previous.path),
    `Lost indexed route: ${previous.path}`
  );
  const html = htmlFor(previous.path);
  const doc = parse(html);
  documentsByRoute.set(previous.path, doc);
  assert(
    /<meta charset="[^"]+"\s*\/?>/i.test(html.slice(0, 1024)),
    `${previous.path}: charset must precede large inline styles`
  );
  linksByRoute.set(
    previous.path,
    [...doc.querySelectorAll('a[href]')].flatMap((link) => {
      const url = new URL(
        link.getAttribute('href')!,
        `${origin}${previous.path}`
      );
      return url.origin === origin
        ? [url.pathname.replace(/\/$/, '') || '/']
        : [];
    })
  );
  assert.equal(
    doc.querySelectorAll('link[rel="canonical"]').length,
    1,
    `${previous.path}: duplicate/missing canonical`
  );
  assert.equal(
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    `${origin}${previous.path}`,
    `${previous.path}: canonical changed`
  );
  assert(
    !doc
      .querySelector('meta[name="robots"]')
      ?.getAttribute('content')
      ?.includes('noindex'),
    `${previous.path}: unexpectedly noindex`
  );
  assert(
    doc.querySelector('meta[name="description"]')?.getAttribute('content'),
    `${previous.path}: missing description`
  );
  assert(
    doc.querySelector(previous.path === '/' ? 'h1' : 'h1, h2'),
    `${previous.path}: missing static heading`
  );
  assert(
    (doc.getElementById('root')?.textContent?.length ?? 0) > 200,
    `${previous.path}: empty HTML shell`
  );
  if (previous.path !== '/')
    assert.equal(doc.title, previous.title, `${previous.path}: title changed`);
  for (const type of previous.schemaTypes)
    assert(
      typesIn(html).includes(type),
      `${previous.path}: lost ${type} structured data`
    );
  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]'
  ))
    JSON.parse(script.textContent);
  const og = doc
    .querySelector('meta[property="og:image"]')
    ?.getAttribute('content');
  assert(og, `${previous.path}: missing social card`);
  if (new URL(og).origin === origin)
    assert(
      fs.existsSync(path.join(directory, new URL(og).pathname)),
      `${previous.path}: missing social image file`
    );
}

// Check destinations as well as reachability: a link to an unknown page or a
// removed fragment can be crawlable while still sending readers to a dead end.
let internalLinks = 0;
let localAssets = 0;
for (const [route, doc] of documentsByRoute) {
  for (const link of doc.querySelectorAll('a[href]')) {
    const url = new URL(link.getAttribute('href')!, `${origin}${route}`);
    if (url.origin !== origin) continue;
    // These paths belong to existing app/Ghost/OIDC CDN origins, not dist-site.
    if (
      /^\/(?:app(?:\/|$)|resources(?:\/|$)|\.well-known\/)/.test(url.pathname)
    )
      continue;
    internalLinks++;
    const destination = url.pathname.replace(/\/$/, '') || '/';
    const filename = path.join(
      directory,
      destination,
      path.extname(destination) ? '' : 'index.html'
    );
    assert(fs.existsSync(filename), `${route}: broken link ${url.href}`);
    const target = documentsByRoute.get(destination);
    if (url.hash && target) {
      const fragment = decodeURIComponent(url.hash.slice(1));
      assert(
        target.getElementById(fragment) ||
          [...target.querySelectorAll('a[name]')].some(
            (anchor) => anchor.getAttribute('name') === fragment
          ),
        `${route}: missing fragment ${url.href}`
      );
    }
  }
  for (const element of doc.querySelectorAll(
    'img[src], script[src], link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"], video[src], source[src]'
  )) {
    const reference =
      element.getAttribute('src') ?? element.getAttribute('href');
    if (!reference) continue;
    const url = new URL(reference, `${origin}${route}`);
    if (url.origin !== origin) continue;
    localAssets++;
    assert(
      fs.existsSync(path.join(directory, url.pathname)),
      `${route}: missing asset ${url.pathname}`
    );
  }
}

// Follow the real HTML link graph, not just the sitemap: no orphaned pages.
const reachable = new Set(['/']);
const pending = ['/'];
while (pending.length) {
  for (const route of linksByRoute.get(pending.pop()!) ?? []) {
    if (linksByRoute.has(route) && !reachable.has(route)) {
      reachable.add(route);
      pending.push(route);
    }
  }
}
for (const route of baseline.routes)
  assert(reachable.has(route.path), `Orphaned page: ${route.path}`);

const home = parse(htmlFor('/'));
for (const route of [
  '/email',
  '/tasks',
  '/channels',
  '/documents',
  '/calls',
  '/crm',
  '/agents',
  '/github',
  '/pricing',
  '/partners',
  '/posts',
  '/migrate',
]) {
  assert(
    home.querySelector(`a[href="${route}"]`),
    `Homepage lacks a crawlable link to ${route}`
  );
}
for (const route of ['/start', '/mobile-signup', '/mobile-signup-sent']) {
  assert(!routes.includes(route), `Signup route leaked into sitemap: ${route}`);
  assert(
    parse(htmlFor(route))
      .querySelector('meta[name="robots"]')
      ?.getAttribute('content')
      ?.includes('noindex'),
    `${route}: missing noindex`
  );
}
const robots = fs.readFileSync(path.join(directory, 'robots.txt'), 'utf8');
assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
assert(
  origin === 'https://macro.com'
    ? robots.includes('Allow: /') && !/^Disallow: \/$/m.test(robots)
    : /^Disallow: \/$/m.test(robots),
  'Wrong environment crawl policy'
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, '.vite/manifest.json'), 'utf8')
);
const assets = new Set<string>();
function visit(key: string) {
  const chunk = manifest[key];
  if (!chunk || assets.has(chunk.file)) return;
  assets.add(chunk.file);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
visit('start.html');
const bytes = [...assets].reduce(
  (total, file) =>
    total + gzipSync(fs.readFileSync(path.join(directory, file))).byteLength,
  0
);
assert(
  bytes < 400_000,
  `Homepage initial JS exceeds 400 KB gzip: ${bytes}; check for eager editor imports`
);
console.log(
  `[seo] Preserved ${baseline.routes.length} live URLs, static content, schema, metadata, internal links and crawler rules.`
);
console.log(
  `[seo] Validated ${internalLinks} internal links and ${localAssets} local assets.`
);
console.log(
  `[seo] Homepage HTML: ${gzipSync(Buffer.from(htmlFor('/'))).byteLength} bytes gzip. Initial JS: ${bytes} bytes gzip (demo code excluded from initial bundle).`
);
