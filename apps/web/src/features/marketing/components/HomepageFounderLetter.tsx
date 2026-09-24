import { onCleanup, onMount } from 'solid-js';

const LETTER =
  'Macro incorporates the best parts of our favorite tools — like Linear, Slack, Notion, Superhuman, and Attio — into a single chat-based interface that keeps the whole company together.';

const phase = (progress: number, start: number, end: number) => {
  const value = Math.max(0, Math.min(1, (progress - start) / (end - start)));
  return value * value * (3 - 2 * value);
};

export function HomepageFounderLetter() {
  let section!: HTMLElement;
  let figure!: HTMLElement;
  let line!: SVGPathElement;
  let lowerLine!: SVGPathElement;
  let lowerHost!: HTMLDivElement;

  onMount(() => {
    const scroller = section.parentElement!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let start = 0;
    let distance = 1;

    const update = () => {
      const progress = reduced.matches
        ? 1
        : Math.max(0, Math.min(1, (scroller.scrollTop - start) / distance));
      // The connection draws first, then reveals the quote. Native scrolling is
      // the only clock, and the complete text remains selectable and accessible.
      line.style.opacity = `${phase(progress, 0.04, 0.25)}`;
      line.style.strokeDashoffset = `${1 - phase(progress, 0.08, 0.62)}`;
      figure.style.opacity = `${phase(progress, 0.58, 0.96)}`;

      const lowerRect = lowerHost.getBoundingClientRect();
      const lowerTop =
        lowerRect.top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const lowerStart = lowerTop - scroller.clientHeight * 0.78;
      const lowerDistance = Math.max(
        1,
        lowerRect.height + scroller.clientHeight * 0.08
      );
      const lowerProgress = reduced.matches
        ? 1
        : Math.max(
            0,
            Math.min(1, (scroller.scrollTop - lowerStart) / lowerDistance)
          );
      lowerLine.style.opacity = `${phase(lowerProgress, 0.04, 0.3)}`;
      lowerLine.style.strokeDashoffset = `${1 - phase(lowerProgress, 0.08, 0.85)}`;
    };
    const measure = () => {
      const rect = section.getBoundingClientRect();
      const top =
        rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      start = top - scroller.clientHeight * 0.86;
      distance = Math.max(1, rect.height + scroller.clientHeight * 0.1);
      update();
    };

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(section);
    resize.observe(scroller);
    scroller.addEventListener('scroll', update, { passive: true });
    reduced.addEventListener('change', update);
    onCleanup(() => {
      resize.disconnect();
      scroller.removeEventListener('scroll', update);
      reduced.removeEventListener('change', update);
    });
  });

  return (
    <section
      ref={section}
      aria-label="A note from our founder"
      class="homepage-founder-letter relative mx-auto w-[min(480px,calc(100%-48px))] text-center text-[13px] leading-[1.45] font-normal text-[#717171] md:w-[min(600px,calc(100%-48px))]"
      style={{ 'font-family': '"Inter Variable", var(--font-sans)' }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 104"
        class="homepage-founder-rule mx-auto mb-6 h-[104px] w-4 overflow-visible md:mb-[30px] md:h-[130px]"
        fill="none"
      >
        <path
          ref={line}
          d="M8 0V104"
          pathLength="1"
          stroke="currentColor"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
          stroke-dasharray="1"
          stroke-dashoffset="1"
        />
      </svg>
      <figure ref={figure} class="m-0">
        <blockquote class="m-0">
          <p class="m-0">{LETTER}</p>
        </blockquote>
        <figcaption class="mt-5 flex flex-col gap-0.5 md:mt-[25px]">
          <span>Jacob Beckerman</span>
          <span>Co-Founder &amp; CEO at Macro</span>
        </figcaption>
      </figure>
      <div ref={lowerHost}>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 104"
          class="homepage-founder-rule mx-auto mt-6 h-[104px] w-4 overflow-visible md:mt-[30px] md:h-[130px]"
          fill="none"
        >
          <path
            ref={lowerLine}
            d="M8 0V104"
            pathLength="1"
            stroke="currentColor"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
            stroke-dasharray="1"
            stroke-dashoffset="1"
          />
        </svg>
      </div>
    </section>
  );
}
