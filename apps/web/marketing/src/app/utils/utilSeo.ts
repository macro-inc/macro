import { isServer } from 'solid-js/web';
import { APP_BASE_URL } from './utilBaseUrl';

export interface PageSeo {
  /** Document/og title, e.g. 'Jobs at Macro'. */
  title: string;
  /** Meta description (aim for ~150-160 chars). */
  description: string;
  /** Canonical path, e.g. '/jobs'. Query strings and hashes are never canonical. */
  path: string;
  /** Open Graph type. Defaults to 'website'. */
  type?: 'website' | 'article';
  /** ISO date for og:type article (article:published_time). */
  publishedTime?: string;
  /** ISO date for article:modified_time / BlogPosting.dateModified when the post was revised. */
  modifiedTime?: string;
  /** Absolute URL of the social-share image. Defaults to the site-wide card. */
  image?: string;
  /** Author name for article structured data (BlogPosting.author). */
  author?: string;
  /**
   * Keep the page out of search indexes (`robots: noindex, follow`) and out of
   * the sitemap. For pages that exist for a visitor mid-flow — e.g. the mobile
   * signup steps — not as a landing page.
   */
  noindex?: boolean;
}

export const SITE_NAME = 'Macro';
export const DEFAULT_OG_IMAGE = `${APP_BASE_URL}/og-image.jpg`;

export function canonicalUrl(path: string): string {
  return path === '/' ? `${APP_BASE_URL}/` : `${APP_BASE_URL}${path}`;
}

// During build-time prerendering there is no document; setPageSeo() records
// the page's metadata here and scripts/prerender.ts collects it after
// rendering each route.
let serverSeo: PageSeo | null = null;

export function consumeServerSeo(): PageSeo | null {
  const seo = serverSeo;
  serverSeo = null;
  return seo;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * The static head-tag HTML for a page, as baked into prerendered files.
 * Mirrors exactly what setPageSeo() maintains in the live document.
 */
export function buildSeoTagsHtml(seo: PageSeo): string[] {
  const url = canonicalUrl(seo.path);
  const type = seo.type ?? 'website';
  const tags = [
    `<title>${escapeText(seo.title)}</title>`,
    `<meta data-seo name="description" content="${escapeAttr(seo.description)}">`,
    `<link data-seo rel="canonical" href="${escapeAttr(url)}">`,
    `<meta data-seo property="og:site_name" content="${SITE_NAME}">`,
    `<meta data-seo property="og:title" content="${escapeAttr(seo.title)}">`,
    `<meta data-seo property="og:description" content="${escapeAttr(seo.description)}">`,
    `<meta data-seo property="og:url" content="${escapeAttr(url)}">`,
    `<meta data-seo property="og:type" content="${type}">`,
    `<meta data-seo property="og:image" content="${escapeAttr(seo.image ?? DEFAULT_OG_IMAGE)}">`,
  ];
  if (type === 'article' && seo.publishedTime) {
    tags.push(
      `<meta data-seo property="article:published_time" content="${escapeAttr(seo.publishedTime)}">`
    );
  }
  if (type === 'article' && seo.modifiedTime) {
    tags.push(
      `<meta data-seo property="article:modified_time" content="${escapeAttr(seo.modifiedTime)}">`
    );
  }
  tags.push(
    '<meta data-seo name="twitter:card" content="summary_large_image">',
    '<meta data-seo name="twitter:site" content="@macrodotcom">'
  );
  if (seo.noindex) {
    tags.push('<meta data-seo name="robots" content="noindex, follow">');
  }
  return tags;
}

// Tags created here are marked data-seo to match the defaults in index.html
// and the tags baked in by the prerender step, so there is always exactly one
// tag per key to update.
function upsertMeta(
  attr: 'name' | 'property',
  key: string,
  content: string
): void {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.setAttribute('data-seo', '');
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function removeMeta(attr: 'name' | 'property', key: string): void {
  document.head.querySelector(`meta[${attr}="${key}"]`)?.remove();
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    el.setAttribute('data-seo', '');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Sets the document title and all crawler-facing head tags for the current
 * page. Call from every route component's body (or a createRenderEffect when
 * the metadata depends on route params), so it also runs during build-time
 * prerendering — createEffect/onMount do not.
 */
export function setPageSeo(seo: PageSeo): void {
  if (isServer) {
    serverSeo = seo;
    return;
  }

  const url = canonicalUrl(seo.path);
  const type = seo.type ?? 'website';

  document.title = seo.title;
  upsertMeta('name', 'description', seo.description);
  upsertCanonical(url);

  upsertMeta('property', 'og:site_name', SITE_NAME);
  upsertMeta('property', 'og:title', seo.title);
  upsertMeta('property', 'og:description', seo.description);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:type', type);
  upsertMeta('property', 'og:image', seo.image ?? DEFAULT_OG_IMAGE);

  if (type === 'article' && seo.publishedTime) {
    upsertMeta('property', 'article:published_time', seo.publishedTime);
  } else {
    removeMeta('property', 'article:published_time');
  }

  if (type === 'article' && seo.modifiedTime) {
    upsertMeta('property', 'article:modified_time', seo.modifiedTime);
  } else {
    removeMeta('property', 'article:modified_time');
  }

  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:site', '@macrodotcom');

  if (seo.noindex) {
    upsertMeta('name', 'robots', 'noindex, follow');
  } else {
    removeMeta('name', 'robots');
  }
}
