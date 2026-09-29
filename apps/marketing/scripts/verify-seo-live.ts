import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import baseline from '../seo/migration-baseline.json';

// Run against the candidate CDN before cutover, then the public origin after it.
// No JS, cookies or authentication: this tests the response a crawler receives.
const target = process.argv[2];
assert(
  target,
  'Usage: bun marketing/scripts/verify-seo-live.ts https://candidate-origin'
);
const origin = new URL(target).origin;
const canonicalOrigin = (
  process.env.VITE_APP_BASE_URL || 'https://macro.com'
).replace(/\/$/, '');
const window = new Window();
const failures: string[] = [];
async function check(
  route: string,
  verify: (response: Response, body: string) => void
) {
  try {
    const response = await fetch(`${origin}${route}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    verify(response, await response.text());
  } catch (error) {
    failures.push(
      `${route}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
for (const previous of baseline.routes) {
  await check(previous.path, (response, body) => {
    assert.equal(
      response.status,
      200,
      'Must return content directly, without a redirect'
    );
    assert(
      !response.headers.get('x-robots-tag')?.includes('noindex'),
      'CDN is setting noindex'
    );
    const doc = new window.DOMParser().parseFromString(body, 'text/html');
    assert.equal(
      doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      `${canonicalOrigin}${previous.path}`,
      'Wrong canonical'
    );
    assert(
      !doc
        .querySelector('meta[name="robots"]')
        ?.getAttribute('content')
        ?.includes('noindex'),
      'Page is noindex'
    );
    assert(
      doc.querySelector(previous.path === '/' ? 'h1' : 'h1, h2'),
      'Missing prerendered content'
    );
    assert(
      doc.querySelector('script[type="application/ld+json"]'),
      'Missing structured data'
    );
  });
}
await check('/robots.txt', (response, body) => {
  assert.equal(response.status, 200);
  assert(body.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));
  if (canonicalOrigin === 'https://macro.com')
    assert(!/^Disallow: \/$/m.test(body), 'Production crawling is blocked');
});
await check('/sitemap.xml', (response, body) => {
  assert.equal(response.status, 200);
  for (const route of baseline.routes)
    assert(
      body.includes(`<loc>${canonicalOrigin}${route.path}</loc>`),
      `Missing sitemap URL ${route.path}`
    );
});
await check('/start', (response, body) => {
  assert.equal(response.status, 200);
  assert(body.includes('noindex, follow'), 'Signup flow must stay noindex');
});
await check('/__seo_missing_page__', (response) => {
  assert(
    [404, 410].includes(response.status),
    `Unknown route returned ${response.status}; do not fall back to the homepage`
  );
});
assert.equal(failures.length, 0, failures.join('\n'));
console.log(
  `[seo-live] ${baseline.routes.length} pages, crawler files, signup and HTTP error handling passed at ${origin}`
);
