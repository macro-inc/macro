import { type JSX, Show } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { AiComposeFigure } from '../featureGraphics/AiComposeFigure';

const mobile = () => viewportWidth() < 700;

function FigLabel(props: { children: JSX.Element }) {
  return (
    <span
      style={{
        color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
        'font-family': 'Inter, body',
        'font-size': mobile() ? '11px' : '12px',
        'font-weight': '700',
        'letter-spacing': '0.14em',
        'text-transform': 'uppercase',
      }}
    >
      {props.children}
    </span>
  );
}

export function AiFeatureSection(
  props: { flushBottom?: boolean; hideFig?: boolean } = {}
) {
  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': props.flushBottom ? '0' : mobile() ? '48px' : '72px',
        'padding-inline': mobile() ? '18px' : '24px',
      }}
    >
      <style>{`
        .ai-feature-headline {
          white-space: nowrap;
        }
        @media (max-width: 699px) {
          .ai-feature-headline {
            white-space: normal;
          }
        }
      `}</style>
      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          gap: mobile() ? '28px' : '48px',
          margin: '0 auto',
          'max-width': 'var(--page-max)',
          width: '100%',
        }}
      >
        {/* Header: heading + lede, then the phone figure below. */}
        <div
          class="ai-feature-copy"
          style={{
            display: 'grid',
            gap: mobile() ? '16px' : '20px',
            'justify-items': 'start',
          }}
        >
          <Show when={!props.hideFig}>
            <FigLabel>Feature 1.3</FigLabel>
          </Show>
          <h2
            class="ai-feature-headline"
            style={{
              'font-family': 'display',
              'font-size': mobile() ? '32px' : '42px',
              'font-weight': '315',
              'letter-spacing': '-0.018em',
              'line-height': 1.1,
              margin: '0',
              'max-width': '100%',
              'text-align': 'left',
              'white-space': mobile() ? 'normal' : 'nowrap',
            }}
          >
            {'Unified team-level memory for agents.'}
          </h2>
          <p
            class="ai-feature-lede"
            style={{
              color: 'var(--c4)',
              'font-family': 'Inter, body',
              'font-size': mobile() ? '15.5px' : '15px',
              'font-weight': '400',
              'line-height': mobile() ? 1.5 : 1.6,
              margin: '0',
              'max-width': mobile() ? '578px' : '750px',
              'text-align': 'left',
              'text-wrap': 'pretty',
            }}
          >
            {
              'BYO agents or use the embedded models with unified memory. Macro remembers everything you do across email, tasks, docs, sales, marketing and engineering. One system, one context.'
            }
          </p>
        </div>

        <AiComposeFigure />
      </div>
    </div>
  );
}
