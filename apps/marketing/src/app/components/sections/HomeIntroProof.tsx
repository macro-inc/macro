import { onMount, Show } from 'solid-js';
import IconGithub from '../../../assets/icons/icon-github.svg';
import LogoA16z from '../../../assets/logos/a16z.svg';
import { analytics } from '../../utils/utilAnalytic';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../utils/utilGithubStars';

const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

/** Full-bleed trust band: capital and open source. */
export function HomeIntroProof() {
  onMount(() => {
    ensureGithubStars();
  });

  return (
    <section
      aria-label="Trust signals"
      class="home-proof-section"
      style={{
        'align-items': 'center',
        'box-sizing': 'border-box',
        display: 'flex',
        'flex-wrap': 'wrap',
        'justify-content': 'center',
        position: 'relative',
        width: '100%',
      }}
    >
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        .home-proof-section {
          flex-direction: row;
          gap: 64px;
          min-height: 128px;
          padding: 60px 48px;
        }
        /* Shared column for each signal so the mark, star count, and badges
           sit on one optical line above their captions. */
        .home-proof-signal {
          align-content: center;
          display: grid;
          gap: 12px;
          justify-items: center;
          position: relative;
          z-index: 1;
        }
        .home-proof-caption {
          color: color-mix(in srgb, var(--c4) 74%, transparent);
          font-family: 'body';
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.1em;
          line-height: 1.2;
          text-align: center;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .home-proof-mark-row { height: 44px; }
        .home-proof-a16z { height: 31px; }
        .home-proof-github-row { font-size: 20px; gap: 10px; }
        .home-proof-github-icon { height: 22px; width: 22px; }
        .home-proof-star { height: 17px; width: 17px; }
        .home-proof-divider {
          background-color: color-mix(in srgb, var(--c4) 14%, transparent);
          flex: none;
          height: 48px;
          position: relative;
          width: 1px;
          z-index: 1;
        }
        @media (max-width: 699px) {
          .home-proof-section { gap: 36px; min-height: auto; padding: 42px 14px; }
          .home-proof-signal { gap: 7px; }
          .home-proof-caption { font-size: 9.5px; letter-spacing: 0.06em; }
          .home-proof-mark-row { height: 26px; }
          .home-proof-a16z { height: 17px; }
          .home-proof-github-row { font-size: 13px; gap: 6px; }
          .home-proof-github-icon { height: 15px; width: 15px; }
          .home-proof-star { height: 12px; width: 12px; }
          .home-proof-divider { display: none; }
        }
        /* Only very narrow screens stack; the two signals otherwise stay on
           one line so the band reads as a strip rather than a list. */
        @media (max-width: 359px) {
          .home-proof-section { flex-direction: column; gap: 24px; }
        }
      `}</style>

      <div class="home-proof-signal">
        <span
          class="home-proof-mark-row"
          style={{
            'align-items': 'center',
            display: 'inline-flex',
          }}
        >
          <LogoA16z
            aria-label="Andreessen Horowitz"
            viewBox="0 0 169 40"
            class="home-proof-a16z"
            style={{
              color: 'var(--c1)',
              display: 'block',
              overflow: 'visible',
              width: 'auto',
            }}
          />
        </span>
        <span class="home-proof-caption">$30M+ raised</span>
      </div>

      <span aria-hidden="true" class="home-proof-divider" />

      <a
        href={MACRO_REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Rox on GitHub"
        class="home-proof-signal"
        onClick={() => {
          analytics.track('app_redirect', {
            page_location: window.location.href,
            button_name: 'intro_github',
          });
        }}
        style={{
          color: 'inherit',
          cursor: 'default',
          'text-decoration': 'none',
        }}
      >
        <span
          class="home-proof-mark-row home-proof-github-row"
          style={{
            'align-items': 'center',
            color: 'var(--c1)',
            display: 'inline-flex',
            'font-family': 'body',
            'font-weight': '700',
            'line-height': 1,
          }}
        >
          <IconGithub
            aria-hidden="true"
            class="home-proof-github-icon"
            style={{
              display: 'block',
            }}
          />
          <Show when={githubStars() !== null} fallback={<>GitHub</>}>
            <svg
              viewBox="0 0 256 256"
              fill="currentColor"
              aria-hidden="true"
              class="home-proof-star"
              style={{ color: 'var(--a0)', display: 'block' }}
            >
              <path d="M239.2,97.29a16,16,0,0,0-13.81-11L166,81.17,142.72,25.81h0a15.95,15.95,0,0,0-29.44,0L90.07,81.17,30.61,86.32a16,16,0,0,0-9.11,28.06L66.61,153.8,53.09,212.34a16,16,0,0,0,23.84,17.34l51-31,51.11,31a16,16,0,0,0,23.84-17.34l-13.51-58.6,45.1-39.36A16,16,0,0,0,239.2,97.29Z" />
            </svg>
            {formatStarCount(githubStars()!)}
          </Show>
        </span>
        <span class="home-proof-caption">Full open source</span>
      </a>
    </section>
  );
}
