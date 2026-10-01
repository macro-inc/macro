import { onCleanup, onMount, Show } from 'solid-js';
import {
  ensureGithubStars,
  githubStars,
} from '../../../app/utils/utilGithubStars';
import IconCasa from '../../../assets/designs/design-casa.svg';
import IconIso from '../../../assets/designs/design-iso.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import LogoA16z from '../../../assets/logos/a16z.svg';
import { animateGithubFlow } from './animateGithubFlow';
import { animateOpenSource } from './animateOpenSource';
import './homepage-github.css';

/** The original open-source proof, fed by the demo's color field. */
export function HomepageGithub(props: { motion?: 'bubbles' } = {}) {
  let section!: HTMLElement;
  onMount(() => {
    ensureGithubStars();
    let scroller = section.parentElement!;
    while (
      scroller.parentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    onCleanup(
      props.motion === 'bubbles'
        ? animateOpenSource(section, scroller)
        : animateGithubFlow(section, scroller)
    );
  });
  return (
    <section
      ref={section}
      class="homepage-open-source"
      aria-labelledby="open-source-title"
    >
      <Show when={props.motion !== 'bubbles'}>
        <svg
          class="homepage-github-flow"
          viewBox="0 0 1200 900"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="github-flow-color"
              x1="0"
              y1="0"
              x2="1"
              y2=".65"
            >
              <stop offset="0" stop-color="#635573" />
              <stop offset=".38" stop-color="#266d71" />
              <stop offset=".7" stop-color="#636f46" />
              <stop offset="1" stop-color="#886344" />
            </linearGradient>
            <linearGradient id="github-flow-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="white" stop-opacity="0" />
              <stop offset=".2" stop-color="white" stop-opacity=".35" />
              <stop offset=".65" stop-color="white" />
              <stop offset="1" stop-color="white" stop-opacity=".5" />
            </linearGradient>
            <mask id="github-flow-mask">
              <rect width="1200" height="900" fill="url(#github-flow-fade)" />
            </mask>
            <filter
              id="github-flow-grain"
              x="-10%"
              y="-10%"
              width="120%"
              height="120%"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency=".65"
                numOctaves="3"
                stitchTiles="stitch"
                result="noise"
              />
              <feColorMatrix in="noise" type="saturate" values="0" />
              <feBlend in="SourceGraphic" mode="multiply" />
              <feComposite in2="SourceGraphic" operator="in" />
            </filter>
          </defs>
          <g mask="url(#github-flow-mask)">
            <path
              class="homepage-github-liquid"
              fill="url(#github-flow-color)"
              filter="url(#github-flow-grain)"
            />
            <path
              class="homepage-github-current"
              fill="none"
              stroke="#83a6a0"
              stroke-width="1"
            />
          </g>
        </svg>
      </Show>
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
  );
}
