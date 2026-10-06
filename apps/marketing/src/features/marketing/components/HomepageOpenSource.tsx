import { createMediaQuery } from '@solid-primitives/media';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { animateDemoEntrance } from './animateDemoEntrance';
import { HomepageDemoCarousel } from './HomepageDemoCarousel';
import { HomepageGithub } from './HomepageGithub';
import { HomepageMobileOpenSource } from './HomepageMobileOpenSource';
import './homepage-open-source.css';

/** Lead with the live sample workspace; keep open-source proof underneath. */
function DesktopHomepageOpenSource(props: {
  children: JSX.Element;
  showSidebarBreakdown: boolean;
}) {
  const [loaded, setLoaded] = createSignal(false);
  let section!: HTMLElement;
  let connection!: HTMLDivElement;
  let frame!: HTMLIFrameElement;
  let line!: SVGPathElement;

  onMount(() => {
    let scroller: HTMLElement = section.parentElement!;
    while (
      scroller.parentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    onCleanup(animateDemoEntrance(section, scroller));
    if (!props.showSidebarBreakdown) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const card = connection.querySelector<HTMLElement>(
      '.homepage-sidebar-window'
    )!;
    const anchor = connection.querySelector<HTMLElement>(
      '.homepage-sidebar-line-anchor'
    )!;
    let travel = 1;
    let start = 0;
    let lastProgress = -1;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const update = () => {
      const progress = reduced.matches
        ? 1
        : clamp((scroller.scrollTop - start) / travel);
      if (progress === lastProgress) return;
      lastProgress = progress;
      line.style.strokeDashoffset = `${1 - progress}`;
    };
    const measure = () => {
      const bounds = connection.getBoundingClientRect();
      const tip = anchor.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      // Cache the document position so scroll never forces layout after the
      // constellation's animation writes earlier in the same event.
      start =
        bounds.top -
        viewport.top +
        scroller.scrollTop -
        scroller.clientHeight * 0.8;
      lastProgress = -1;
      const scale = connection.clientWidth / bounds.width;
      const x = (tip.left - bounds.left) * scale;
      const y = (tip.top - bounds.top) * scale;
      const center = (viewport.left + viewport.width / 2 - bounds.left) * scale;
      const mobile = window.matchMedia('(max-width: 799px)').matches;
      line.setAttribute(
        'd',
        mobile
          ? `M${center} 0V${y * 0.25}C${center} ${y * 0.65} ${x} ${y * 0.65} ${x} ${y}`
          : `M${x} 0V${y}`
      );
      travel = Math.max(1, y);
      update();
    };
    const resize = new ResizeObserver(measure);
    resize.observe(connection);
    resize.observe(scroller);
    resize.observe(card);
    scroller.addEventListener('scroll', update, { passive: true });
    reduced.addEventListener('change', update);
    measure();
    onCleanup(() => {
      resize.disconnect();
      scroller.removeEventListener('scroll', update);
      reduced.removeEventListener('change', update);
    });
  });

  return (
    <>
      <section
        ref={section}
        class="homepage-embedded-demo workspace-demo"
        aria-label="Explore Macro interactively"
        id="interactive-demo"
      >
        <div class="homepage-embedded-stage">
          <div class="homepage-embedded-wallpaper">
            <div class="homepage-embedded-window">
              <div class="homepage-embedded-content">
                <Show when={!loaded()}>
                  <div class="homepage-embedded-loading" role="status">
                    Opening your workspace…
                  </div>
                </Show>
                <iframe
                  ref={frame}
                  src="/demo?embedded=true"
                  loading="lazy"
                  title="Embedded Macro sample workspace"
                  onLoad={() => setLoaded(true)}
                />
              </div>
            </div>
          </div>
        </div>
        <HomepageDemoCarousel frame={() => frame} />
        <HomepageGithub />
      </section>
      <Show when={props.showSidebarBreakdown}>
        <div ref={connection} class="homepage-sidebar-connection">
          <svg
            class="homepage-sidebar-connection-line"
            aria-hidden="true"
            fill="none"
          >
            <path ref={line} pathLength="1" />
          </svg>
          {props.children}
        </div>
      </Show>
    </>
  );
}

/** Desktop keeps the live workspace; mobile retains the original diagram story. */
export function HomepageOpenSource(props: {
  children: JSX.Element;
  showSidebarBreakdown: boolean;
}) {
  const desktop = createMediaQuery('(min-width: 800px)', true);
  return (
    <Show
      when={desktop()}
      fallback={
        <HomepageMobileOpenSource>{props.children}</HomepageMobileOpenSource>
      }
    >
      <DesktopHomepageOpenSource
        showSidebarBreakdown={props.showSidebarBreakdown}
      >
        {props.children}
      </DesktopHomepageOpenSource>
    </Show>
  );
}
