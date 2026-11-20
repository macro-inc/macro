import { loaders } from 'virtual:macro-docs';
import { useLocation } from '@solidjs/router';
import { createEffect, lazy, onCleanup, onMount, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { documentationComponents } from './DocumentationContent';
import './documentation.css';
import './feature-guide.css';

const guides = Object.fromEntries(
  Object.entries(loaders).map(([slug, load]) => [slug, lazy(load)])
);

/** Keep reference material on the product page, without crowding its story. */
export function FeatureGuide(props: { slug: string }) {
  const location = useLocation();
  let disclosure!: HTMLDetailsElement;
  const revealAnchor = () => {
    let hash: string;
    try {
      hash = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    if (!hash) return;
    const target =
      document.getElementById(`guide-${hash}`) ?? document.getElementById(hash);
    if (target && disclosure.contains(target)) {
      disclosure.open = true;
      target.scrollIntoView({ block: 'start' });
    }
  };
  onMount(() => {
    revealAnchor();
    // Lazy MDX may finish after mount or after navigation to another feature.
    const observer = new MutationObserver(revealAnchor);
    observer.observe(disclosure, { childList: true, subtree: true });
    window.addEventListener('hashchange', revealAnchor);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('hashchange', revealAnchor);
    });
  });
  createEffect(() => {
    props.slug;
    if (disclosure) disclosure.open = false;
  });
  createEffect(() => {
    location.hash;
    if (disclosure) revealAnchor();
  });
  return (
    <section
      class="feature-guide feature-page-reading"
      aria-label="Setup and reference"
    >
      <details ref={disclosure} id="guide">
        <summary>Setup and reference</summary>
        <article class="documentation-body">
          <Suspense fallback={<p>Loading reference…</p>}>
            <Dynamic
              component={guides[props.slug]}
              components={documentationComponents}
            />
          </Suspense>
        </article>
      </details>
    </section>
  );
}
