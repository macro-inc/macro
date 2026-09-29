import { onMount, Show } from 'solid-js';
import IconGithub from '../../../assets/icons/icon-github.svg';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../utils/utilGithubStars';

const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

export function ButtonGithubStars(props: {
  mobile?: boolean;
  compact?: boolean;
  class?: string;
  variant?: 'hero' | 'header';
  onClick?: (event: MouseEvent) => void;
}) {
  const header = () => props.variant === 'header';

  onMount(() => {
    ensureGithubStars();
  });

  return (
    <a
      href={MACRO_REPO_URL}
      target="_blank"
      rel="noreferrer"
      class={props.class}
      aria-label="Macro on GitHub"
      onClick={props.onClick}
      style={{
        'align-items': 'center',
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': header() ? '14px' : props.mobile ? '16px' : '17px',
        'font-weight': '700',
        gap: header() ? '6px' : '8px',
        height: header() ? '30px' : props.mobile ? '46px' : '48px',
        'justify-content': 'center',
        'letter-spacing': header() ? '0.02em' : '0.01em',
        'line-height': 1,
        padding: header() ? (props.compact ? '0 11px' : '0 14px') : '0 22px',
        'text-decoration': 'none',
        transition: header()
          ? 'background-color 220ms ease, border-color 220ms ease, color 220ms ease, transform 160ms ease'
          : 'transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <IconGithub
        aria-hidden="true"
        style={{
          display: 'block',
          height: header() ? '15px' : '17px',
          width: header() ? '15px' : '17px',
        }}
      />
      <Show when={!props.compact}>GitHub</Show>
      <Show when={githubStars() !== null}>
        <Show when={!props.compact}>
          <span
            aria-hidden="true"
            style={{
              color: 'color-mix(in srgb, var(--c1) 30%, transparent)',
              'font-weight': '400',
            }}
          >
            |
          </span>
        </Show>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            gap: '5px',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 256 256"
            fill="currentColor"
            aria-hidden="true"
            style={{ color: 'var(--a0)', display: 'block' }}
          >
            <path d="M239.2,97.29a16,16,0,0,0-13.81-11L166,81.17,142.72,25.81h0a15.95,15.95,0,0,0-29.44,0L90.07,81.17,30.61,86.32a16,16,0,0,0-9.11,28.06L66.61,153.8,53.09,212.34a16,16,0,0,0,23.84,17.34l51-31,51.11,31a16,16,0,0,0,23.84-17.34l-13.51-58.6,45.1-39.36A16,16,0,0,0,239.2,97.29Z" />
          </svg>
          {formatStarCount(githubStars()!)}
        </span>
      </Show>
    </a>
  );
}
