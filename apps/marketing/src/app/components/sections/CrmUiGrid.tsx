import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  EnrichedDetailsGraphic,
  MentionsGraphic,
  RiskFlagGraphic,
  TeamSharingGraphic,
} from '../featureGraphics/CrmGraphics';

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
};

// Four distinct silhouettes — a details list, a doc composer with the real
// typeahead, a segmented account list, and an agent alert card — so the grid
// reads as four different moments in the product, not one card repeated.
const cells: UiCell[] = [
  {
    title: 'Auto-enriched',
    body: 'Firmographics, headcount, and funding fill themselves in the moment a record exists.',
    Graphic: EnrichedDetailsGraphic,
  },
  {
    title: '@mention anywhere',
    body: 'Reference any CRM record inline in documents, emails, or threads for instant context.',
    Graphic: MentionsGraphic,
  },
  {
    title: 'Shared by default',
    body: 'Every record is team-visible from day one — deals stop living in personal spreadsheets.',
    Graphic: TeamSharingGraphic,
  },
  {
    title: 'Agent flags risk',
    body: 'Deals going quiet get flagged before they slip, with a follow-up already drafted.',
    Graphic: RiskFlagGraphic,
  },
];

const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)';

export function CrmUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;
  const cols = () => (stacked() ? 1 : 2);

  return (
    <section
      aria-label="CRM in action"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          border: '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
          'border-radius': mobile() ? '16px' : '20px',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': '100%',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <For each={cells}>
          {(cell, index) => (
            <div
              style={{
                'border-left':
                  index() % cols() !== 0
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'border-top':
                  index() >= cols()
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                'grid-template-rows': '1fr auto',
              }}
            >
              {/* Graphic area */}
              <div
                style={{
                  'align-items': 'center',
                  display: 'grid',
                  'justify-items': 'center',
                  'min-height': mobile() ? '0' : '300px',
                  overflow: 'hidden',
                  padding: mobile() ? '16px 0 0' : '20px 0 0',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    background:
                      'radial-gradient(58% 54% at 50% 42%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                    inset: '0',
                    'pointer-events': 'none',
                    position: 'absolute',
                  }}
                />
                <div
                  style={{
                    display: 'grid',
                    'justify-items': 'center',
                    '-webkit-mask-image': GRAPHIC_FADE,
                    'mask-image': GRAPHIC_FADE,
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <cell.Graphic />
                </div>
              </div>
              {/* Caption */}
              <div
                style={{
                  display: 'grid',
                  gap: mobile() ? '8px' : '10px',
                  padding: mobile() ? '2px 22px 30px' : '6px 34px 36px',
                }}
              >
                <h3
                  style={{
                    color: 'var(--c2)',
                    'font-family': 'body',
                    'font-size': mobile() ? '14px' : '15px',
                    'font-weight': '700',
                    'letter-spacing': '0.07em',
                    'line-height': 1.2,
                    margin: 0,
                    'text-transform': 'uppercase',
                  }}
                >
                  {cell.title}
                </h3>
                <p
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'body',
                    'font-size': mobile() ? '15px' : '16px',
                    'font-weight': '400',
                    'line-height': 1.5,
                    margin: 0,
                    'max-width': '420px',
                  }}
                >
                  {cell.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
