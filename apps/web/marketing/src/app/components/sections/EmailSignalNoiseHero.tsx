import {
  EmailListCardGraphic,
  NOISE_GROUPS,
  SIGNAL_GROUPS,
} from '../graphics/EmailListCardGraphic';

// The new top-of-page hero graphic: a static "signal vs noise" composite —
// the Noise card (node 6:335) sits behind as a long, dimmed pile of
// newsletters/promos, and the Signal card (node 2:2) floats in front of it,
// offset down the Y axis with a heavy shadow to sell the overlap. Replaces
// the interactive demo as the lead visual; the interactive demo moves to its
// own section further down the page.
// Short fade at the bottom of the Noise pile so it dissolves out under the
// Signal card instead of ending on a hard edge.
const NOISE_FADE =
  'linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%)';

// Horizontal offset between the two cards (Signal sits this far right of
// Noise) — split evenly around center so the pair, as a whole, stays centered
// even though the individual cards don't share a left edge.
const STACK_OFFSET_X = 200;

export function EmailSignalNoiseHero(props: { mobile: () => boolean }) {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': props.mobile() ? '40px 24px' : '56px 40px',
        'padding-inline': props.mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{ position: 'relative', width: '100%', 'max-width': '900px' }}
      >
        {/* Noise — the backdrop pile: dimmed, desaturated, faded top/bottom so it
            reads as clutter receding behind the signal card. Pushed down with
            real padding (not a position offset) so the stack's layout height
            actually includes the push and the next section doesn't overlap it. */}
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.65) brightness(0.8)',
            '-webkit-mask-image': NOISE_FADE,
            'mask-image': NOISE_FADE,
            opacity: 0.9,
            'padding-top': '150px',
            'pointer-events': 'none',
            position: 'relative',
            transform: `translateX(-${STACK_OFFSET_X / 2}px)`,
            'z-index': 0,
          }}
        >
          <EmailListCardGraphic
            selectedTab="Noise"
            groups={NOISE_GROUPS}
            style={{ margin: '0 auto' }}
          />
        </div>

        {/* Signal — the hero card: floated forward with a y offset and a heavy
            shadow to sell the overlap. */}
        <div
          style={{
            filter:
              'drop-shadow(0 50px 70px rgb(0 0 0 / 0.9)) drop-shadow(0 18px 32px rgb(0 0 0 / 0.9))',
            left: '50%',
            position: 'absolute',
            top: '50px',
            transform: `translateX(calc(-50% + ${STACK_OFFSET_X / 2}px))`,
            width: '94%',
            'z-index': 1,
          }}
        >
          <EmailListCardGraphic
            selectedTab="Signal"
            groups={SIGNAL_GROUPS}
            footer
            style={{ margin: '0 auto' }}
          />
        </div>
      </div>
    </div>
  );
}
