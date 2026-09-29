import { Show } from 'solid-js';
import IconGithub from '../../../assets/icons/icon-github.svg';
import { breakpoint, viewportWidth } from '../../utils/utilBreakpoint';
import { ButtonLaunch } from '../buttons/ButtonLaunch';
import { SceneMobile } from '../scenes/SceneMobile';

export function SectionHero() {
  const isCompact = () => viewportWidth() < 700;

  return (
    <div
      style={{
        'padding-top': isCompact() ? '20px' : breakpoint() ? '32px' : '76px',
        display: 'grid',
        gap: isCompact() ? '12px' : breakpoint() ? '4px' : '44px',
        'justify-items': 'center',
      }}
    >
      <div
        style={{
          'max-width': breakpoint() ? '100%' : '600px',
          display: 'grid',
          width: '100%',
          gap: isCompact() ? '18px' : breakpoint() ? '22px' : '30px',
          'margin-bottom': isCompact() ? '8px' : breakpoint() ? '20px' : '24px',
          'justify-items': 'center',
          'text-align': 'center',
        }}
      >
        <span
          style={{
            'font-family': 'rajdhani, body',
            'font-size': isCompact() ? '10px' : breakpoint() ? '9px' : '16px',
            color: 'var(--a0)',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
            'text-decoration': 'none',
          }}
        >
          Macro raises $30M led by a16z &rarr;
        </span>
        <div
          style={{
            'letter-spacing': '-0.02em',
            'line-height': 1.1,
            'font-size': isCompact() ? '31px' : breakpoint() ? '40px' : '52px',
            'font-family': 'display',
            'font-weight': '410',
          }}
        >
          The new office suite.
        </div>
        <div
          style={{
            'line-height': 1.32,
            'max-width': isCompact()
              ? '340px'
              : breakpoint()
                ? '400px'
                : '440px',
            'font-size': isCompact()
              ? '16px'
              : breakpoint()
                ? '17.5px'
                : '21px',
            color: 'var(--c4)',
          }}
        >
          Email, messages, docs, tasks, calls, and code in one app your whole
          team shares.
        </div>

        <div
          style={{
            display: 'inline-grid',
            'grid-auto-flow': 'column',
            'align-items': 'center',
            gap: '10px',
          }}
        >
          <ButtonLaunch tone="dark" />
          <a
            href="https://github.com/macro-inc/macro"
            target="_blank"
            rel="noreferrer"
            aria-label="View Macro on GitHub"
            class="hover-relaunch"
            style={{
              width: '28px',
              height: '28px',
              display: 'inline-grid',
              'place-items': 'center',
              'border-radius': '3px',
              'background-color': 'var(--b1)',
              border:
                '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
              'box-sizing': 'border-box',
              color: 'var(--c1)',
              cursor: 'default',
            }}
          >
            <IconGithub
              style={{
                width: '13px',
                height: '13px',
                display: 'block',
              }}
            />
          </a>
        </div>
      </div>

      <Show when={breakpoint()}>
        <div style={{ 'margin-top': '0px', 'margin-bottom': '-60px' }}>
          <SceneMobile />
        </div>
      </Show>
    </div>
  );
}
