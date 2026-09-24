import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import {
  ensureGithubStars,
  githubStars,
} from '../../../../marketing/src/app/utils/utilGithubStars';
import IconCasa from '../../../../marketing/src/assets/designs/design-casa.svg';
import IconIso from '../../../../marketing/src/assets/designs/design-iso.svg';
import IconSoc2 from '../../../../marketing/src/assets/designs/design-soc2.svg';
import IconGithub from '../../../../marketing/src/assets/icons/icon-github.svg';
import LogoA16z from '../../../../marketing/src/assets/logos/a16z.svg';
import { animateOpenSource } from './animateOpenSource';
import './homepage-open-source.css';

/** Open-source proof, connected to the product through native scroll position. */
export function HomepageOpenSource(props: { children: JSX.Element }) {
  let section!: HTMLElement;
  let connection!: HTMLDivElement;
  let line!: SVGPathElement;

  onMount(() => {
    ensureGithubStars();
    let scroller: HTMLElement = connection.parentElement!;
    while (
      scroller.parentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    onCleanup(animateOpenSource(section, scroller));
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
        class="homepage-open-source workspace-demo"
        aria-labelledby="open-source-title"
      >
        <a
          class="homepage-github-link"
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
          aria-label="Explore Macro on GitHub"
        >
          <div class="homepage-github-orbit">
            <div class="homepage-github-mark glass">
              <IconGithub aria-hidden="true" />
            </div>
          </div>
          <span class="homepage-github-stars">
            <Show
              when={githubStars() !== null}
              fallback={<span>Explore the source ↗</span>}
            >
              <span class="homepage-github-star" aria-hidden="true">
                ★
              </span>
              <span>{githubStars()?.toLocaleString('en-US')} stars</span>
            </Show>
          </span>
        </a>
        <h2 id="open-source-title">
          Fully open source.
          <br />
          Yours to build on.
        </h2>
        <p class="homepage-open-source-subtext">
          #1 on GitHub Trending in August.
          <br />
          Read the code. Make it your own.
        </p>
        <div class="homepage-open-source-badges">
          <div class="homepage-open-source-backing">
            <LogoA16z aria-label="Andreessen Horowitz" viewBox="0 0 169 40" />
            <span>Backed by a16z · $30M+ raised</span>
          </div>
          <div class="homepage-open-source-security">
            <div aria-label="Security certifications">
              <IconIso aria-label="ISO 27001" />
              <IconSoc2 aria-label="AICPA SOC 2" />
              <IconCasa aria-label="CASA Tier 2" />
            </div>
            <span>ISO 27001 · SOC 2 · CASA Tier 2</span>
          </div>
        </div>
      </section>
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
    </>
  );
}
