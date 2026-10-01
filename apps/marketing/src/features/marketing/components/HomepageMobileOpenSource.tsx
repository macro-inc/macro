import { type JSX, onCleanup, onMount } from 'solid-js';
import { HomepageGithub } from './HomepageGithub';

/** Preserve the original compact story on mobile, without mounting the demo. */
export function HomepageMobileOpenSource(props: { children: JSX.Element }) {
  let connection!: HTMLDivElement;
  let line!: SVGPathElement;

  onMount(() => {
    let scroller: HTMLElement = connection.parentElement!;
    while (
      scroller.parentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
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
    <div class="homepage-mobile-story">
      <HomepageGithub motion="bubbles" />
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
    </div>
  );
}
