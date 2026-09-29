/**
 * SSR entry for build-time prerendering. Compiled by `vite build -c
 * vite.prerender.config.ts` into dist-prerender/, then driven by
 * scripts/prerender.ts under Bun — no browser involved.
 */
import {
  generateHydrationScript,
  renderToString,
  renderToStringAsync,
} from 'solid-js/web';
import { App } from '../src/app/main/App';
import {
  buildSeoTagsHtml,
  canonicalUrl,
  consumeServerSeo,
  type PageSeo,
} from '../src/app/utils/utilSeo';
import { Homepage } from '../src/features/setup/Homepage';
import { themes } from '../src/lib/theme/signals/themeSignals';
import { posts } from '../src/routes/posts/registry';

export type { PageSeo };
export { buildSeoTagsHtml, canonicalUrl };

export async function renderPage(
  url: string
): Promise<{ html: string; seo: PageSeo | null }> {
  const html = await renderToStringAsync(() => <App url={url} />);
  return { html, seo: consumeServerSeo() };
}

/** Routes for every published post, straight from the registry. */
export const postRoutes: string[] = posts.map((p) => `/posts/${p.meta.slug}`);

export const postDates: Record<string, string | undefined> = Object.fromEntries(
  posts.map((p) => [`/posts/${p.meta.slug}`, p.meta.date])
);

/**
 * The CSS custom properties that the theme system applies to <html> at
 * runtime (see themeReactive.ts). Effects don't run during SSR, so the
 * prerenderer bakes these into the static HTML to avoid a flash of unthemed
 * content before the bundle executes.
 */
export function themeHtmlStyle(themeId = 'Macro'): string {
  const theme = themes().find((t) => t.id === themeId);
  if (!theme) throw new Error(`themeHtmlStyle: theme not found: ${themeId}`);
  const declarations = ['--transition: 0.2s'];
  for (const [token, channels] of Object.entries(theme.tokens)) {
    for (const [channel, value] of Object.entries(channels)) {
      declarations.push(
        `--${token}${channel}: ${value}${channel === 'h' ? 'deg' : ''}`
      );
    }
  }
  return declarations.join('; ');
}

/**
 * The slice of index.css that first paint depends on, inlined into <head> by
 * the prerenderer so the page paints from the first HTML chunk instead of
 * waiting a network round-trip for the render-blocking bundle.
 *
 * Two things in here are load-bearing, not cosmetic:
 *  - themeHtmlStyle() bakes the l/c/h channels onto <html>, but the colors
 *    those compose into (`--b0` and friends) live in the bundle. Until they
 *    exist, the `background-color: var(--b0)` on <html> can't resolve and the
 *    page paints white.
 *  - the .ssg-* gates decide which of the dual-rendered mobile/desktop
 *    variants is visible, so without them both render at once.
 *
 * Keep in sync with src/app/main/index.css; the bundle still loads after this
 * and wins on conflicts, so these are duplicated values, never overrides.
 */
export function criticalCss(themeId = 'Macro'): string {
  const theme = themes().find((t) => t.id === themeId);
  if (!theme) throw new Error(`criticalCss: theme not found: ${themeId}`);

  const colors = Object.keys(theme.tokens).map((token) =>
    // --a0h-drift is registered via @property (initial 0deg) in the bundle;
    // the fallback keeps the accent valid until that lands.
    token === 'a0'
      ? '--a0:oklch(var(--a0l) var(--a0c) calc(var(--a0h) + var(--a0h-drift, 0deg)));'
      : `--${token}:oklch(var(--${token}l) var(--${token}c) var(--${token}h));`
  );

  return [
    // The two first-paint families. index.html preloads these files, but the
    // @font-face rules that put them to use are in the bundle, so without
    // this the hero paints in a fallback serif and reflows on arrival.
    "@font-face{src:url('/fonts/roboto-slab-variable.woff2') format('woff2');font-family:'display';font-weight:100 900;font-display:swap}",
    "@font-face{src:url('/fonts/rajdhani-medium.woff2') format('woff2');font-family:'body';font-display:swap}",
    ':root{--page-gutter:24px;--page-max-mobile:560px;--page-max:1000px;--site-scale:1;--ambient-ink:color-mix(in srgb,var(--c1) 25%,transparent);',
    ...colors,
    '}',
    '@media (max-width:700px){:root{--page-gutter:12px}}',
    'html,body{background-color:var(--b0)}',
    "body{margin:0;color:var(--c2);font-family:'body';font-size:16px}",
    '.ssg-mobile,.ssg-desktop{display:contents}',
    '@media (min-width:700px){.ssg-mobile{display:none}}',
    '@media (max-width:699px){.ssg-desktop{display:none}}',
    // Safari min-content blowout guard: without it sections can paint wider
    // than the viewport and slide back when the bundle arrives.
    '#app-scroll-root :is(section,div):not(.no-scrollbar,.no-scrollbar *){min-width:0}',
  ].join('');
}

/** Real Solid SSR markup, so the browser keeps the headline instead of replacing it. */
export function renderHomepage(): { html: string; hydration: string } {
  return {
    html: renderToString(() => <Homepage />),
    hydration: generateHydrationScript(),
  };
}
