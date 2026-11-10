import {
  type DocNavigation,
  loaders,
  navigation,
  pages,
} from 'virtual:macro-docs';
import { Navigate, useLocation } from '@solidjs/router';
import { createMemo, createRenderEffect, lazy, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import redirects from '../../../../seo/page-redirects.json';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { SitePageClosing } from '../../marketing/components/SitePageClosing';
import { BENEFIT_PAGES } from '../../marketing/core/benefit-pages';
import { FEATURE_PAGES } from '../../marketing/core/navigation';
import { BenefitPage } from '../../marketing/views/BenefitPage';
import { documentationComponents } from '../components/DocumentationContent';
import '../components/documentation.css';
import '../components/guide-home-preview.css';
import '../components/guide-db-preview.css';
import '../components/guide-book-preview.css';
import '../components/guide-routine-preview.css';
import '../components/guide-share-preview.css';

const components = Object.fromEntries(
  Object.entries(loaders).map(([slug, load]) => [slug, lazy(load)])
);
function flatten(entries: DocNavigation[]): string[] {
  return entries.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : flatten(entry.pages)
  );
}
const order = flatten(navigation);
export default function DocumentationPage() {
  const location = useLocation();
  const slug = () => {
    try {
      return (
        decodeURIComponent(
          location.pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '')
        ) || 'index'
      );
    } catch {
      return '';
    }
  };
  const page = createMemo(() => pages.find((page) => page.slug === slug()));
  const neighbors = createMemo(() => {
    const index = order.indexOf(slug());
    return {
      previous: pages.find((p) => p.slug === order[index - 1]),
      next: pages.find((p) => p.slug === order[index + 1]),
    };
  });
  createRenderEffect(() =>
    setPageSeo({
      title: `${page()?.title ?? 'Guide not found'} · Macro`,
      description: page()?.description ?? 'Browse the Macro documentation.',
      path: page()?.href ?? location.pathname,
      noindex: !page(),
    })
  );
  return (
    <Show
      when={
        !(redirects as Record<string, string>)[
          location.pathname.replace(/\/$/, '')
        ]
      }
      fallback={
        <Navigate
          href={`${(redirects as Record<string, string>)[location.pathname.replace(/\/$/, '')]}${location.search}${location.hash}`}
        />
      }
    >
      <Show
        when={Object.hasOwn(BENEFIT_PAGES, slug())}
        fallback={
          <main class="documentation-page">
            <Show
              when={page()}
              fallback={
                <>
                  <h1>Guide not found</h1>
                  <p>
                    This guide may have moved.{' '}
                    <a href="/docs">Browse the documentation</a> or search using
                    the menu.
                  </p>
                </>
              }
            >
              {(page) => (
                <>
                  <header class="documentation-heading">
                    <h1>{page().title}</h1>
                    <p>{page().description}</p>
                    <Show
                      when={FEATURE_PAGES.find(
                        (feature) => feature.guide === page().href
                      )}
                    >
                      {(feature) => (
                        <a href={feature().href}>
                          See the {feature().label} overview and demos ↗
                        </a>
                      )}
                    </Show>
                  </header>
                  <article class="documentation-body">
                    <Suspense fallback={<p>Loading guide…</p>}>
                      <Dynamic
                        component={components[page().slug]}
                        components={documentationComponents}
                      />
                    </Suspense>
                  </article>
                  <nav
                    class="documentation-pagination"
                    aria-label="More guides"
                  >
                    <Show when={neighbors().previous}>
                      {(prev) => (
                        <a href={prev().href}>
                          <small>Previous</small>← {prev().title}
                        </a>
                      )}
                    </Show>
                    <Show when={neighbors().next}>
                      {(next) => (
                        <a href={next().href}>
                          <small>Next</small>
                          {next().title} →
                        </a>
                      )}
                    </Show>
                  </nav>
                  <p class="documentation-help">
                    Still have a question?{' '}
                    <a href="/docs/support">Get in touch.</a>
                  </p>
                </>
              )}
            </Show>
          </main>
        }
      >
        <BenefitPage slug={slug()} />
      </Show>
      <SitePageClosing />
    </Show>
  );
}
