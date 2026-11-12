import { useNavigate } from '@solidjs/router';
import {
  createSignal,
  For,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import { pageOutlineLabels } from './page-outline-labels';
import './page-outline.css';

/** A shared reading column with section links, separate from the site navigation. */
export function PageOutline(props: ParentProps) {
  const navigate = useNavigate();
  let content!: HTMLDivElement;
  const [headings, setHeadings] = createSignal<HTMLHeadingElement[]>([]);
  const [active, setActive] = createSignal('');
  onMount(() => {
    let sections: HTMLHeadingElement[] = [];
    const visible = new Set<Element>();
    const intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        const current = sections.find((heading) => visible.has(heading));
        if (current) setActive(current.id);
      },
      {
        root: document.getElementById('app-scroll-root'),
        rootMargin: '-100px 0px -60% 0px',
      }
    );
    const update = () => {
      const next = Array.from(
        content.querySelectorAll<HTMLHeadingElement>(
          '.product-feature-intro h2, .feature-page-reading > h2, .documentation-body h2, .documentation-body h3'
        )
      ).filter(
        (heading) =>
          !heading.closest(
            '.guide-graphic, .tutorial-video-embed, .feature-guide, .product-demo'
          )
      );
      if (
        next.length === sections.length &&
        next.every((heading, index) => heading === sections[index])
      )
        return;
      intersection.disconnect();
      visible.clear();
      setActive('');
      sections = next;
      for (const [index, heading] of sections.entries()) {
        if (!heading.id) heading.id = `page-section-${index + 1}`;
        intersection.observe(heading);
      }
      setHeadings(sections);
    };
    update();
    const mutations = new MutationObserver(update);
    mutations.observe(content, { childList: true, subtree: true });
    onCleanup(() => {
      mutations.disconnect();
      intersection.disconnect();
    });
  });
  return (
    <div class="page-outline-layout">
      <div ref={content} class="page-outline-content">
        {props.children}
      </div>
      <Show when={headings().length}>
        <nav class="page-outline" aria-label="On this page">
          <p>On this page</p>
          <For each={headings()}>
            {(heading) => (
              <a
                href={`#${heading.id}`}
                aria-current={active() === heading.id ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`#${heading.id}`, { replace: true, scroll: false });
                  heading.scrollIntoView({
                    behavior: matchMedia('(prefers-reduced-motion: reduce)')
                      .matches
                      ? 'instant'
                      : 'smooth',
                    block: 'start',
                  });
                  setActive(heading.id);
                }}
              >
                {heading.textContent?.startsWith('Questions about')
                  ? 'FAQ'
                  : (pageOutlineLabels[heading.id] ??
                    pageOutlineLabels[heading.textContent ?? ''] ??
                    heading.textContent)}
              </a>
            )}
          </For>
        </nav>
      </Show>
    </div>
  );
}
