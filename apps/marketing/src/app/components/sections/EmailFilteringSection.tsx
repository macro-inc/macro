import { For, Show } from 'solid-js';
import { breakpoint } from '../../utils/utilBreakpoint';
import { GRID_COLS, GRID_GAP } from '../base/BaseHeader';
import { EmailTurboInbox } from './EmailTurboInbox';

// "Spend less time on email" — a one-line title + supporting copy sharing a
// baseline, running along the top of the interactive Macro Mail mockup below.
// The header owns the section's top spacing; EmailTurboInbox (hero) drops its
// own top padding so the two read as one section.
export function EmailFilteringSection(props: { mobile: () => boolean }) {
  const mobile = props.mobile;
  return (
    <section
      aria-label="Spend less time on email"
      style={{ 'box-sizing': 'border-box', width: '100%' }}
    >
      {/* Header row: title + supporting line on the left, an orange 3-item
          checklist on the right. Stacks on mobile. */}
      <div
        style={{
          'align-items': breakpoint() ? 'flex-start' : 'center',
          'box-sizing': 'border-box',
          display: breakpoint() ? 'flex' : 'grid',
          // Desktop (>=1030px): the SAME grid params BaseHeader uses (shared
          // GRID_COLS / GRID_GAP + var(--page-max) + 14px padding), so the
          // checklist sits in the same centered middle column as the header's
          // nav items. At medium/narrow it gives way to a simple stacked column
          // (like the hero); type still switches at the narrower mobile().
          'grid-template-columns': breakpoint() ? undefined : GRID_COLS,
          'flex-wrap': 'wrap',
          'flex-direction': breakpoint() ? 'column' : 'row',
          gap: breakpoint() ? '24px' : GRID_GAP,
          'justify-content': 'flex-start',
          margin: mobile() ? '0 auto 28px' : '0 auto 36px',
          'max-width': 'var(--page-max)',
          'padding-top': mobile() ? '52px' : '84px',
          'padding-bottom': mobile() ? '16px' : '36px',
          'padding-left': mobile() ? '18px' : '14px',
          'padding-right': mobile() ? '18px' : '14px',
          width: '100%',
        }}
      >
        {/* Left: title + supporting line */}
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            'flex-direction': 'column',
            gap: '8px',
            'padding-right': breakpoint() ? '0' : '24px',
            'text-align': 'left',
          }}
        >
          <h2
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': mobile() ? '26px' : '42px',
              'font-weight': '410',
              'letter-spacing': '-0.015em',
              'line-height': 1.5,
              margin: 0,
            }}
          >
            Email less.
          </h2>
          <p
            style={{
              color: 'var(--c4)',
              'font-family': 'body',
              'font-size': mobile() ? '15px' : '24px',
              'line-height': 1.5,
              margin: 0,
            }}
          >
            Let{' '}
            <span
              style={{
                color: 'var(--a0)',
                'font-family': 'rajdhani, body',
                'letter-spacing': '0em',
              }}
            >
              Macro Mail
            </span>{' '}
            filter and draft for you.
          </p>
        </div>

        {/* Right: an orange checklist, left-aligned to the header nav's middle
            items (the second grid column). */}
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            'grid-column': breakpoint() ? undefined : '3',
            'justify-self': breakpoint() ? undefined : 'start',
          }}
        >
          <ul
            style={{
              display: 'grid',
              gap: mobile() ? '9px' : '12px',
              'list-style': 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <For
              each={[
                'Filters out the noise.',
                'Drafts replies in your voice.',
                'Helps you reach inbox zero faster.',
              ]}
            >
              {(phrase) => (
                <li
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '10px',
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    style={{ display: 'block', flex: 'none' }}
                  >
                    <path
                      d="M12 5 V19 M5 12 H19"
                      fill="none"
                      stroke="var(--a0)"
                      stroke-width="2.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span
                    style={{
                      color: 'var(--a0)',
                      'font-family': 'body',
                      'font-size': mobile() ? '15px' : '16px',
                      'line-height': 1.4,
                    }}
                  >
                    {phrase}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>

      {/* The mockup frame: a top-lit gradient fill, plus a masked 1px gradient
          border ring (::before) that paints ONLY the ring — never behind the
          content — so it's fully independent of the semi-transparent fill and
          reads a touch lighter than it. */}
      <style>{`
        .email-filter-frame { position: relative; }
        .email-filter-frame::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(to bottom, color-mix(in srgb, var(--c1) 10%, transparent) 0%, color-mix(in srgb, var(--c1) 7%, transparent) 45%, transparent 80%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>
      <Show when={!mobile()}>
        <div
          class="email-filter-frame"
          style={{
            background:
              'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 24%, transparent) 0%, color-mix(in srgb, var(--c1) 5%, transparent) 45%, transparent 62%)',
            'border-radius': '8px',
            'box-sizing': 'border-box',
            'max-width': '1160px',
            'padding-top': '48px',
            width: '100%',
          }}
        >
          <EmailTurboInbox mobile={mobile} hero />
        </div>
      </Show>
    </section>
  );
}
