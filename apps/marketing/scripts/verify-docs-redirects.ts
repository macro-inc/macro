import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import config from '../../docs/docs.json';
import publishedPaths from '../seo/legacy-docs-paths.json';
import redirects from '../seo/page-redirects.json';

const docsRoot = path.resolve(import.meta.dirname, '../../docs');
const dist = path.resolve(import.meta.dirname, '../dist');
const originArg = process.argv.find((arg) => arg.startsWith('--origin='));
const previewOrigin = originArg?.slice('--origin='.length);

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

// Resolve the exact and suffix-wildcard syntax used by our Mintlify records.
// The host applies these before serving a page. This checks the committed
// records, not a separate copy of the migration mapping.
function destination(source: string): URL {
  const url = new URL(source, 'https://docs.macro.com');
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  const exact = config.redirects.find((rule) => rule.source === pathname);
  const rule =
    exact ??
    config.redirects.find(
      (candidate) =>
        candidate.source.endsWith('/:path*') &&
        pathname.startsWith(candidate.source.slice(0, -':path*'.length))
    );
  assert(rule, `No redirect record for ${source}`);
  assert.equal(rule.permanent, true, `Temporary redirect: ${source}`);
  const suffix = pathname.slice(rule.source.indexOf(':path*'));
  const result = new URL(rule.destination.replace(':path*', suffix));
  assert.equal(
    result.origin,
    'https://macro.com',
    `Wrong destination host: ${source}`
  );
  assert(!result.pathname.includes('*'), `Unresolved wildcard: ${source}`);
  result.search = url.search;
  result.hash = url.hash;
  return result;
}

assert.equal(
  new Set(config.redirects.map((r) => r.source)).size,
  config.redirects.length,
  'Duplicate redirect sources'
);
const sources = new Set([
  ...publishedPaths,
  '/',
  '/index',
  '/sitemap.xml',
  '/robots.txt',
  '/favicon.svg',
  '/llms.txt',
  '/llms-full.txt',
]);
for (const filename of files(docsRoot)) {
  const relative = path.relative(docsRoot, filename);
  if (relative.endsWith('.mdx')) sources.add(`/${relative.slice(0, -4)}`);
  else if (/^(images|videos|logo)\//.test(relative))
    sources.add(`/${relative}`);
}
for (const source of [...sources]) {
  if (source !== '/' && !path.extname(source)) {
    sources.add(`${source}/`);
    sources.add(`${source}.md`);
  }
}
sources.add('/index.md');
const targets = new Set<string>();
for (const source of sources) {
  const target = destination(source);
  const filename = path.join(
    dist,
    target.pathname.slice(1),
    path.extname(target.pathname) ? '' : 'index.html'
  );
  assert(
    fs.existsSync(filename) && fs.statSync(filename).isFile(),
    `${source} redirects to missing file ${target.pathname}`
  );
  if (filename.endsWith('.html')) {
    const html = fs.readFileSync(filename, 'utf8');
    assert(
      /<h1[\s>]/.test(html),
      `${source}: destination has no rendered page`
    );
    assert(
      !/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/.test(html),
      `${source}: destination is an error or noindex page`
    );
  }
  targets.add(target.pathname);
}
// Queries and hashes are not part of a redirect source; the destination must
// not introduce a fragment that replaces a reader's existing deep link.
for (const rule of config.redirects)
  assert(!/[?#]/.test(rule.source + rule.destination));
assert.equal(
  destination('/product/email?from=docs#sharing').href,
  'https://macro.com/email?from=docs#sharing'
);
assert.equal(
  destination('/product/email.md').pathname,
  '/docs/product/email.md'
);
for (const source of [
  '/product/email#sharing',
  '/product/docs#notifications',
  '/product/crm#team-sharing',
]) {
  const target = destination(source);
  const html = fs.readFileSync(
    path.join(dist, target.pathname, 'index.html'),
    'utf8'
  );
  assert(
    html.includes(`id="${target.hash.slice(1)}"`) ||
      html.includes(`id="guide-${target.hash.slice(1)}"`),
    `${source}: legacy heading is missing at ${target.pathname}`
  );
}

// Both website and legacy-host URLs must end directly at real content.
for (const [source, target] of Object.entries(redirects)) {
  assert(
    !Object.hasOwn(redirects, target),
    `${source}: redirect chain or loop`
  );
  const filename = path.join(
    dist,
    target.slice(1),
    path.extname(target) ? '' : 'index.html'
  );
  assert(fs.existsSync(filename), `${source}: missing ${target}`);
  assert(
    !fs
      .readFileSync(filename, 'utf8')
      .includes('name="robots" content="noindex"'),
    `${source}: destination is a redirect stub`
  );
}
if (previewOrigin) {
  for (const [source, target] of Object.entries(redirects)) {
    for (const suffix of ['', ...(path.extname(source) ? [] : ['/'])]) {
      const response: Response = await fetch(
        `${previewOrigin}${source}${suffix}?from=legacy`,
        { redirect: 'manual' }
      );
      assert.equal(response.status, 308, source);
      assert.equal(
        response.headers.get('location'),
        `${target}?from=legacy`,
        source
      );
      await response.body?.cancel();
    }
  }
  const remaining = [...targets];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const target = remaining.pop();
        if (!target) return;
        const response: Response = await fetch(new URL(target, previewOrigin), {
          redirect: 'manual',
        });
        assert.equal(
          response.status,
          200,
          `${target}: HTTP ${response.status}`
        );
        if (!path.extname(target)) {
          const html = await response.text();
          assert(
            /<h1[\s>]/.test(html),
            `${target}: HTTP response has no rendered page`
          );
        } else await response.body?.cancel();
      }
    })
  );
}
console.log(
  `[docs redirects] ${publishedPaths.length} published URLs; ${sources.size} page, Markdown, trailing-slash and asset URLs resolve to ${targets.size} existing destinations.`
);
if (previewOrigin)
  console.log(
    `[docs redirects] All ${targets.size} destinations returned HTTP 200 at ${previewOrigin}.`
  );
