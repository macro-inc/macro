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
  let topNode!: SVGCircleElement;
  let bottomNode!: SVGCircleElement;

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
      topNode.style.opacity = `${phase(progress, 0, 0.18)}`;
      line.style.opacity = `${phase(progress, 0.04, 0.25)}`;
      line.style.strokeDashoffset = `${1 - phase(progress, 0.08, 0.62)}`;
      bottomNode.style.opacity = `${phase(progress, 0.54, 0.72)}`;
      figure.style.opacity = `${phase(progress, 0.58, 0.96)}`;
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
      class="relative mx-auto w-[min(480px,calc(100%-48px))] pb-3 text-center text-sm leading-[1.8] font-normal text-ink-muted md:w-[min(600px,calc(100%-48px))] md:pb-[15px] md:text-[17.5px]"
      style={{ 'font-family': '"Inter Variable", var(--font-sans)' }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 104"
        class="mx-auto mb-6 h-[104px] w-4 overflow-visible text-ink-extra-muted md:mb-[30px] md:h-[130px] md:w-5"
        fill="none"
      >
        <circle ref={topNode} cx="8" cy="6" r="2.5" stroke="currentColor" />
        <path
          ref={line}
          d="M8 9V95"
          pathLength="1"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="1"
          stroke-dashoffset="1"
        />
        <circle ref={bottomNode} cx="8" cy="98" r="2.5" stroke="currentColor" />
      </svg>
      <figure ref={figure} class="m-0">
        <blockquote class="m-0">
          <p class="m-0">{LETTER}</p>
        </blockquote>
        <figcaption class="mt-5 flex flex-col gap-0.5 text-xs leading-5 md:mt-[25px] md:gap-[2.5px] md:text-[15px] md:leading-[25px]">
          <span>Jacob Beckerman</span>
          <span class="text-ink-extra-muted">
            Co-Founder &amp; CEO at Macro
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
