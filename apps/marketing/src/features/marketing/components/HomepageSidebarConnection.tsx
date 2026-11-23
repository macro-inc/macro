import { type JSX, onCleanup, onMount } from 'solid-js';
import './homepage-open-source.css';

/** Draw the connection into the sidebar as it enters the viewport. */
export function HomepageSidebarConnection(props: { children: JSX.Element }) {
  let connection!: HTMLDivElement;
  let line!: SVGPathElement;
  let endpoint!: SVGCircleElement;

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
    const signup = connection
      .closest('.page-aura')
      ?.querySelector<HTMLElement>('.homepage-hero-cta');
    let travel = 1;
    let start = 0;
    let lastProgress = -1;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const update = () => {
      const progress =
        reduced.matches && scroller.scrollTop > start
          ? 1
          : clamp((scroller.scrollTop - start) / travel);
      if (progress === lastProgress) return;
      lastProgress = progress;
      line.style.strokeDashoffset = `${1 - progress}`;
      endpoint.style.opacity = progress >= 1 ? '1' : '0';
    };
    const measure = () => {
      const bounds = connection.getBoundingClientRect();
      const tip = anchor.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const button = signup?.getBoundingClientRect();
      // Cache the document position so scrolling only updates the line's stroke.
      start = Math.max(
        0,
        (button?.bottom ?? bounds.top) -
          viewport.top +
          scroller.scrollTop -
          scroller.clientHeight * 0.8
      );
      lastProgress = -1;
      const scale = connection.clientWidth / bounds.width;
      const x = (tip.left - bounds.left) * scale;
      const y = (tip.top - bounds.top) * scale;
      const fromX = button
        ? (button.left + button.width / 2 - bounds.left) * scale
        : x;
      const fromY = button ? (button.bottom - bounds.top) * scale : 0;
      const bendY = fromY + (y - fromY) * 0.65;
      const mobile = window.matchMedia('(max-width: 699px)').matches;
      line.setAttribute(
        'd',
        mobile
          ? `M${fromX} ${fromY}V${y}`
          : `M${fromX} ${fromY}V${fromY + (y - fromY) * 0.25}C${fromX} ${bendY} ${x} ${bendY} ${x} ${y}`
      );
      const endpointX = mobile ? fromX : x;
      const endpointY = mobile ? y + 2 : y;
      endpoint.setAttribute('cx', `${endpointX}`);
      endpoint.setAttribute('cy', `${endpointY}`);
      travel = Math.max(1, y - fromY);
      update();
    };
    const resize = new ResizeObserver(measure);
    resize.observe(connection);
    resize.observe(scroller);
    resize.observe(card);
    if (signup) resize.observe(signup.closest('.macro-home-hero') ?? signup);
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
      <div ref={connection} class="homepage-sidebar-connection">
        <svg
          class="homepage-sidebar-connection-line"
          aria-hidden="true"
          fill="none"
        >
          <path ref={line} pathLength="1" />
          <circle
            ref={endpoint}
            r={2.55}
            class="homepage-sidebar-connection-endpoint"
          />
        </svg>
        {props.children}
      </div>
    </div>
  );
}
