import { For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { viewportWidth } from '../../utils/utilBreakpoint';

// ---------------------------------------------------------------------------
// SectionFaq
//
// Shared FAQ accordion matching the email page. Pass page-specific
// question/answer pairs via `items`.
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;

export type FaqItem = { q: string; a: JSX.Element };

export const dataSecurityFaqItem: FaqItem = {
  q: 'Is our workspace data secure?',
  a: (
    <>
      Yes. Open source means the Macro application code is available to inspect.
      It does not make your workspace public. Data in your Macro account,
      including your team’s email, documents, messages, and other workspace
      content, remains private and secure.
    </>
  ),
};

// `hideHeading` drops the "FAQ" title for callers that already frame the list
// (the aria-label still names the region for assistive tech). `embedded`
// is the comparison-section treatment: no title, no extra section padding,
// and the same measure as the comparison table.
export function SectionFaq(props: {
  items: FaqItem[];
  hideHeading?: boolean;
  embedded?: boolean;
  /** Match the comparison table wrap when `embedded`. Defaults to 920px. */
  maxWidth?: string;
}) {
  const hideHeading = () => Boolean(props.hideHeading || props.embedded);
  const embeddedMaxWidth = () => props.maxWidth ?? '920px';
  return (
    <Dynamic
      component={props.embedded ? 'div' : 'section'}
      aria-label="Frequently asked questions"
      classList={{ 'faq--embedded': Boolean(props.embedded) }}
      style={{
        'background-color': props.embedded ? 'transparent' : 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: hideHeading() ? '0' : mobile() ? '24px' : '40px',
        'justify-items': 'stretch',
        'margin-top': props.embedded ? (mobile() ? '16px' : '24px') : '0',
        'max-width': props.embedded ? embeddedMaxWidth() : undefined,
        padding: props.embedded ? '0' : mobile() ? '48px 18px' : '72px 54px',
        width: props.embedded ? '100%' : undefined,
      }}
    >
      <style>{`
        .faq__item { border-bottom: 1px solid color-mix(in srgb, var(--c4) 10%, transparent); }
        .faq__item > summary {
          align-items: center;
          color: var(--c1);
          cursor: default;
          display: flex;
          font-family: 'cyberreader';
          font-size: 16px;
          font-weight: 400;
          gap: 16px;
          justify-content: space-between;
          letter-spacing: -0.01em;
          list-style: none;
          padding: 22px 4px;
        }
        .faq--embedded .faq__item > summary { padding: 22px 20px; }
        .faq__item > summary::-webkit-details-marker { display: none; }
        .faq__item > summary .faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .faq__answer { color: var(--c4); font-family: 'cyberreader'; font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .faq--embedded .faq__answer { max-width: none; padding: 0 20px 24px; }
        .faq__answer a { color: var(--a0); text-decoration: none; }
        .faq__answer code { background: color-mix(in srgb, var(--c4) 12%, transparent); border-radius: 4px; font-size: 13px; padding: 1px 5px; }
        @media (hover) {
          .faq__answer a:hover { text-decoration: underline; }
        }
        @media (max-width: 700px) {
          .faq__item > summary { font-size: 15px; padding: 18px 4px; }
          .faq--embedded .faq__item > summary { padding: 18px 14px; }
          .faq--embedded .faq__answer { padding: 0 14px 24px; }
        }
      `}</style>
      <Show when={!hideHeading()}>
        <div
          style={{
            display: 'grid',
            gap: '12px',
            'justify-items': 'center',
            'max-width': '720px',
            'text-align': 'center',
          }}
        >
          <h2
            style={{
              color: 'var(--a0)',
              'font-family': 'rajdhani, body',
              'font-size': mobile() ? '26px' : '36px',
              'font-weight': '700',
              'letter-spacing': '0.08em',
              margin: 0,
              'text-transform': 'uppercase',
            }}
          >
            FAQ
          </h2>
        </div>
      </Show>
      <div
        style={{
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          width: '100%',
          'max-width': props.embedded ? 'none' : '860px',
        }}
      >
        <For each={props.items}>
          {(item) => (
            <details class="faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </Dynamic>
  );
}
