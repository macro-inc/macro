/**
 * Build-time prerenderer (static-site generation, no browser).
 *
 * Runs after `vite build` and `vite build -c vite.prerender.config.ts`:
 * renders every public route to HTML with Solid's renderToStringAsync and
 * writes it to `dist/<route>/index.html` (plus sitemap.xml and robots.txt).
 * The deployed S3 bucket then serves real, content-complete HTML to crawlers
 * and agents that don't execute JavaScript, while the client bundle still
 * boots and takes over in browsers (src/app/main/index.tsx clears #root
 * before render()).
 *
 * Usage: bun scripts/prerender.ts
 * Env:   VITE_APP_BASE_URL — public origin used for sitemap/robots/JSON-LD
 *        (defaults to https://macro.com, matching src/app/utils/utilBaseUrl.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { Window as HappyWindow } from 'happy-dom';
import type { PageSeo } from '../src/app/utils/utilSeo';

// Scene modules parse their SVG sources with DOMParser at import time;
// happy-dom (pure JS, no browser) provides it for the SSR render.
(globalThis as Record<string, unknown>).DOMParser = new HappyWindow().DOMParser;

// Built by vite.prerender.config.ts; compiled for SSR so component bodies run
// without a DOM. Imported dynamically so the polyfill above is in place first.
const {
  renderPage,
  buildSeoTagsHtml,
  canonicalUrl,
  themeHtmlStyle,
  criticalCss,
  postRoutes,
} = (await import(
  // @ts-expect-error -- untyped build artifact; the cast restores the types
  '../../dist-site-prerender/prerenderEntry.js'
)) as typeof import('./prerenderEntry');

const DIST_DIR = path.resolve(import.meta.dirname, '../../dist-site');
const BASE_URL = (process.env.VITE_APP_BASE_URL || 'https://macro.com').replace(
  /\/$/,
  ''
);

// Used as <lastmod> for routes without their own published date, so the sitemap
// reflects when the site was last rebuilt.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// /test (internal playground) is intentionally not prerendered or listed.
// The /mobile-signup* pages are prerendered because a direct hit has to resolve
// to real HTML (CloudFront rewrites extensionless paths to <route>/index.html,
// so an unbuilt route 404s), but they set `noindex` and are kept out of the
// sitemap — they are steps inside the signup flow, not landing pages.
const STATIC_ROUTES = [
  '/jobs',
  '/terms',
  '/privacy',
  '/dpa',
  '/posts',
  '/startups',
  '/tasks',
  '/email',
  '/documents',
  '/channels',
  '/calls',
  '/crm',
  '/agents',
  '/github',
  '/pricing',
  '/partners',
  '/partners/terms',
  '/migrate',
  '/mobile-signup',
  '/mobile-signup-sent',
];

// Lazy-loaded route modules, used to look up each route's code-split JS/CSS in
// the build manifest so prerendered pages link their stylesheets up front (no
// flash of unstyled content) and preload their chunks.
const ROUTE_MODULES: Array<[RegExp, string]> = [
  [/^\/jobs$/, 'src/app/routes/RouteJobs.tsx'],
  [/^\/terms$/, 'src/app/routes/RouteTerms.tsx'],
  [/^\/privacy$/, 'src/app/routes/RoutePrivacy.tsx'],
  [/^\/dpa$/, 'src/app/routes/RouteDpa.tsx'],
  [/^\/startups$/, 'src/app/routes/RouteStartups.tsx'],
  [/^\/tasks$/, 'src/app/routes/RouteTasks.tsx'],
  [/^\/email$/, 'src/app/routes/RouteEmail.tsx'],
  [/^\/documents$/, 'src/app/routes/RouteDocuments.tsx'],
  [/^\/channels$/, 'src/app/routes/RouteChannels.tsx'],
  [/^\/calls$/, 'src/app/routes/RouteCalls.tsx'],
  [/^\/crm$/, 'src/app/routes/RouteCrm.tsx'],
  [/^\/agents$/, 'src/app/routes/RouteAgents.tsx'],
  [/^\/github$/, 'src/app/routes/RouteGithub.tsx'],
  [/^\/pricing$/, 'src/app/routes/RoutePricing.tsx'],
  [/^\/partners$/, 'src/app/routes/RoutePartners.tsx'],
  [/^\/partners\/terms$/, 'src/app/routes/RoutePartnerTerms.tsx'],
  [/^\/migrate$/, 'src/app/routes/RouteMigrate.tsx'],
  [/^\/mobile-signup$/, 'src/app/routes/RouteMobileSignup.tsx'],
  [/^\/mobile-signup-sent$/, 'src/app/routes/RouteMobileSignupSent.tsx'],
  [/^\/posts$/, 'src/routes/posts/index.tsx'],
  [/^\/posts\/.+$/, 'src/routes/posts/PostPage.tsx'],
];

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
}
type Manifest = Record<string, ManifestChunk>;

/** All JS and CSS files a manifest entry pulls in, including static imports. */
function collectChunkAssets(
  manifest: Manifest,
  key: string
): { js: string[]; css: string[] } {
  const js = new Set<string>();
  const css = new Set<string>();
  const visit = (k: string) => {
    const chunk = manifest[k];
    if (!chunk || js.has(chunk.file)) return;
    js.add(chunk.file);
    for (const c of chunk.css ?? []) css.add(c);
    for (const imp of chunk.imports ?? []) visit(imp);
  };
  visit(key);
  return { js: [...js], css: [...css] };
}

// Short, human-readable names for each route, used for breadcrumb trails.
// Google promotes these into the per-page hierarchy shown under a result.
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Home',
  '/jobs': 'Careers',
  '/terms': 'Terms',
  '/privacy': 'Privacy',
  '/dpa': 'Data Processing Agreement',
  '/posts': 'Blog',
  '/startups': 'Startups',
  '/tasks': 'Tasks',
  '/email': 'Macro Mail',
  '/documents': 'Documents',
  '/channels': 'Channels',
  '/calls': 'Calls',
  '/crm': 'CRM',
  '/agents': 'Agents',
  '/github': 'GitHub',
  '/pricing': 'Pricing',
  '/partners': 'Partner Program',
  '/partners/terms': 'Partner Program Terms',
  '/migrate': 'Switch your startup to Macro',
  '/mobile-signup': 'Start for free',
  '/mobile-signup-sent': 'Check your email',
};

// Product/feature pages, each describing one part of the Macro app. Used to
// emit a SoftwareApplication block per page so the product pages carry their own
// structured data (not just the site-wide one on the homepage). Names are the
// product names used in copy, independent of the marketing <title>.
const FEATURE_APPS: Record<string, string> = {
  '/tasks': 'Macro Tasks',
  '/email': 'Macro Mail',
  '/documents': 'Macro Docs',
  '/channels': 'Macro Chat',
  '/calls': 'Macro Calls',
  '/crm': 'Macro CRM',
  '/github': 'Macro Reviews',
};

// Sitemap importance/freshness hints, by route. Higher priority and more
// frequent changefreq for the homepage and product pages; lower for legal pages.
function sitemapHints(route: string): { priority: string; changefreq: string } {
  if (route === '/') return { priority: '1.0', changefreq: 'weekly' };
  if (
    route === '/terms' ||
    route === '/privacy' ||
    route === '/dpa' ||
    route === '/partners/terms'
  )
    return { priority: '0.3', changefreq: 'yearly' };
  if (route === '/posts' || /^\/posts\/.+$/.test(route))
    return { priority: '0.6', changefreq: 'weekly' };
  if (route === '/jobs' || route === '/startups')
    return { priority: '0.7', changefreq: 'monthly' };
  // Product/feature pages and pricing.
  return { priority: '0.8', changefreq: 'monthly' };
}

// Pulls the FAQ question/answer pairs out of a page's rendered HTML so we can
// emit FAQPage structured data that exactly mirrors the visible content (a
// Google requirement). Every FAQ section renders the same shape regardless of
// route: <details class="*-faq__item"> with the question in <summary><span> and
// the answer in <p class="*-faq__answer">.
function extractFaq(rootHtml: string): { q: string; a: string }[] {
  const doc = new HappyWindow().document;
  // happy-dom mis-parses <style> blocks nested inside inline SVGs (e.g. the
  // header logo) and silently drops everything after them, which made every
  // FAQ invisible to this extractor. Styles carry no FAQ content — strip them.
  doc.body.innerHTML = rootHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  const items: { q: string; a: string }[] = [];
  // Feature pages: <details class="*-faq__item"> with <summary><span> + .faq__answer.
  for (const el of doc.querySelectorAll('details[class*="faq__item"]')) {
    const q =
      el
        .querySelector('summary span')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? '';
    const a =
      el
        .querySelector('[class*="faq__answer"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? '';
    if (q && a) items.push({ q, a });
  }
  // Blog posts: <div class="mvn-faq"> with alternating <h3> question + <p> answer.
  for (const faq of doc.querySelectorAll('.mvn-faq')) {
    for (const heading of faq.querySelectorAll('h3')) {
      const q = heading.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const parts: string[] = [];
      let sibling = heading.nextElementSibling;
      while (sibling && sibling.tagName === 'P') {
        parts.push(sibling.textContent?.replace(/\s+/g, ' ').trim() ?? '');
        sibling = sibling.nextElementSibling;
      }
      const a = parts.filter(Boolean).join(' ');
      if (q && a) items.push({ q, a });
    }
  }
  return items;
}

// A BreadcrumbList for a route, reinforcing site structure so Google can show a
// hierarchy (and is more likely to surface sitelinks). Returns null for the
// homepage, where a single-item trail adds nothing.
function buildBreadcrumb(route: string, seo: PageSeo): object | null {
  if (route === '/') return null;

  const trail: { name: string; url: string }[] = [
    { name: 'Home', url: `${BASE_URL}/` },
  ];

  if (/^\/posts\/.+$/.test(route)) {
    trail.push({ name: 'Blog', url: `${BASE_URL}/posts` });
    trail.push({ name: seo.title, url: canonicalUrl(seo.path) });
  } else if (route === '/partners/terms') {
    trail.push({
      name: ROUTE_LABELS['/partners'],
      url: `${BASE_URL}/partners`,
    });
    trail.push({ name: ROUTE_LABELS[route], url: canonicalUrl(seo.path) });
  } else {
    trail.push({
      name: ROUTE_LABELS[route] ?? seo.title,
      url: canonicalUrl(seo.path),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.url,
    })),
  };
}

function buildJsonLd(route: string, seo: PageSeo, rootHtml: string): string[] {
  const blocks: object[] = [];
  if (route === '/') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Macro',
      url: `${BASE_URL}/`,
      logo: `${BASE_URL}/og-image.jpg`,
      sameAs: [
        'https://x.com/macrodotcom',
        'https://github.com/macro-inc/macro',
        'https://www.linkedin.com/company/macrocom',
        'https://www.instagram.com/macrodotcom/',
        'https://www.youtube.com/channel/UCcn-1WTGff0X_RscGVtwljQ',
      ],
    });
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Macro',
      url: `${BASE_URL}/`,
    });
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Macro',
      url: `${BASE_URL}/`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'macOS, Windows, Web',
      description: seo.description,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      publisher: {
        '@type': 'Organization',
        name: 'Macro',
        url: `${BASE_URL}/`,
      },
    });
  }
  if (seo.type === 'article') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: seo.title,
      description: seo.description,
      url: canonicalUrl(seo.path),
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl(seo.path) },
      ...(seo.image ? { image: seo.image } : {}),
      ...(seo.publishedTime
        ? {
            datePublished: seo.publishedTime,
            dateModified: seo.modifiedTime ?? seo.publishedTime,
          }
        : {}),
      ...(seo.author
        ? { author: { '@type': 'Person', name: seo.author } }
        : {}),
      publisher: {
        '@type': 'Organization',
        name: 'Macro',
        url: `${BASE_URL}/`,
      },
    });
  }
  const featureName = FEATURE_APPS[route];
  if (featureName) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: featureName,
      url: canonicalUrl(seo.path),
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'macOS, Windows, Web',
      description: seo.description,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      isPartOf: {
        '@type': 'SoftwareApplication',
        name: 'Macro',
        url: `${BASE_URL}/`,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Macro',
        url: `${BASE_URL}/`,
      },
    });
  }
  const faq = extractFaq(rootHtml);
  if (faq.length > 0) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }
  const breadcrumb = buildBreadcrumb(route, seo);
  if (breadcrumb) blocks.push(breadcrumb);
  return blocks.map(
    (block) =>
      `<script type="application/ld+json">${JSON.stringify(block)}</script>`
  );
}

function buildHtml(
  template: string,
  manifest: Manifest,
  route: string,
  rootHtml: string,
  seo: PageSeo
): string {
  // Replace the template's default SEO tags with the route's own.
  let html = template
    .replace(/[ \t]*<title>.*?<\/title>\n?/s, '')
    .replace(/[ \t]*<(?:meta|link)\s[^>]*data-seo[^>]*>\n?/g, '');

  // Bake the theme's CSS variables into <html> so the first paint isn't
  // unthemed (at runtime they're applied by an effect in themeReactive.ts).
  html = html.replace(
    /(<html[^>]*style=")([^"]*)/,
    (_, prefix: string, style: string) =>
      `${prefix}${style} ${themeHtmlStyle()};`
  );

  // Inline the first-paint CSS ahead of everything else in <head>, so the page
  // renders as the HTML streams rather than after a round-trip for the
  // render-blocking bundle. Placed first, so the bundle still wins on conflicts.
  html = html.replace(
    '<head>',
    `<head>\n    <style id="critical-css">${criticalCss()}</style>`
  );

  // The prerendered HTML plus the critical CSS above is a complete first paint,
  // so the bundle no longer gates rendering — only interactivity. Yielding
  // bandwidth lets the document and fonts finish first on slow connections.
  html = html.replace(
    /<script type="module"(?![^>]*fetchpriority)/,
    '<script type="module" fetchpriority="low"'
  );

  const headParts = buildSeoTagsHtml(seo);
  const moduleKey = ROUTE_MODULES.find(([pattern]) => pattern.test(route))?.[1];
  if (moduleKey) {
    const { js, css } = collectChunkAssets(manifest, moduleKey);
    for (const file of css) {
      if (!html.includes(file)) {
        headParts.push(`<link rel="stylesheet" crossorigin href="/${file}">`);
      }
    }
    for (const file of js) {
      if (!html.includes(file)) {
        headParts.push(
          `<link rel="modulepreload" crossorigin href="/${file}">`
        );
      }
    }
  }
  headParts.push(...buildJsonLd(route, seo, rootHtml));
  html = html.replace('</head>', `    ${headParts.join('\n    ')}\n  </head>`);

  // renderToStringAsync appends hydration-data scripts (self.$R/_$HY) after
  // suspended boundaries; the client re-renders instead of hydrating, so they
  // are dead weight that throws on load. The app itself renders no <script>.
  const cleanRoot = rootHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

  const rootOpen = '<div id="root">';
  if (!html.includes(`${rootOpen}</div>`)) {
    throw new Error('Could not find empty #root in the built index.html');
  }
  return html.replace(`${rootOpen}</div>`, `${rootOpen}${cleanRoot}</div>`);
}

function outputPathFor(route: string): string {
  return route === '/'
    ? path.join(DIST_DIR, 'index.html')
    : path.join(DIST_DIR, route.slice(1), 'index.html');
}

function writeSitemapAndRobots(
  rendered: Array<{ route: string; seo: PageSeo }>
): void {
  const urls = rendered
    // noindex pages (signup-flow steps) are prerendered but never advertised.
    .filter(({ seo }) => !seo.noindex)
    .map(({ route, seo }) => {
      const lastmod = seo.modifiedTime ?? seo.publishedTime ?? BUILD_DATE;
      const { priority, changefreq } = sitemapHints(route);
      return `  <url><loc>${canonicalUrl(route)}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
    })
    .join('\n');
  fs.writeFileSync(
    path.join(DIST_DIR, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
  // Keep non-production deployments (dev.macro.com) out of search indexes.
  const rules =
    BASE_URL === 'https://macro.com'
      ? 'User-agent: *\nAllow: /\nDisallow: /test\nDisallow: /app'
      : 'User-agent: *\nDisallow: /';
  fs.writeFileSync(
    path.join(DIST_DIR, 'robots.txt'),
    `${rules}\n\nSitemap: ${BASE_URL}/sitemap.xml\n`
  );
}

const JOURNEY_SEO: PageSeo = {
  title: 'Macro — One unified interface for all your work.',
  description:
    'Your conversations, documents, and tools, together in one workspace. Explore Macro and build a connected home for your team’s work.',
  path: '/',
};

async function main(): Promise<void> {
  const templatePath = path.join(DIST_DIR, 'index.html');
  const manifestPath = path.join(DIST_DIR, '.vite/manifest.json');
  if (!fs.existsSync(templatePath) || !fs.existsSync(manifestPath)) {
    throw new Error('dist/ is incomplete — run `vite build` first');
  }
  const template = fs.readFileSync(templatePath, 'utf-8');
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const routes = [...STATIC_ROUTES, ...postRoutes];
  const rendered: Array<{ route: string; seo: PageSeo; html: string }> = [];

  for (const route of routes) {
    const { html, seo } = await renderPage(route);
    if (!seo) {
      throw new Error(
        `Route ${route} did not call setPageSeo() during render — add it to the route component`
      );
    }
    if (!html.trim()) throw new Error(`Route ${route} rendered no HTML`);
    rendered.push({ route, seo, html });
    console.log(
      `[prerender] ${route} ok (${(html.length / 1024).toFixed(0)} KB)`
    );
  }

  // Write after rendering everything: '/' replaces dist/index.html, which is
  // also the template.
  for (const { route, seo, html } of rendered) {
    const outPath = outputPathFor(route);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buildHtml(template, manifest, route, html, seo));
  }
  writeSitemapAndRobots([{ route: '/', seo: JOURNEY_SEO }, ...rendered]);

  console.log(
    `[prerender] Wrote ${rendered.length} pages + sitemap.xml + robots.txt`
  );
}

await main();

// The public landing and /start share the resumable journey bundle.
const journey = fs
  .readFileSync(path.join(DIST_DIR, 'start.html'), 'utf8')
  .replace(/<title>.*?<\/title>/, buildSeoTagsHtml(JOURNEY_SEO).join('\n'));
fs.writeFileSync(path.join(DIST_DIR, 'index.html'), journey);
fs.mkdirSync(path.join(DIST_DIR, 'start'), { recursive: true });
fs.writeFileSync(path.join(DIST_DIR, 'start/index.html'), journey);
