import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import FlexChannels from '../../../assets/graphics/tasks-flex-manage-channel.svg';
import FlexMcp from '../../../assets/graphics/tasks-flex-mcp.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';
import '../../routes/RouteTasks.css';
import type { Component, JSX } from 'solid-js';

// ---------------------------------------------------------------------------
// The same task, driven two ways — a channel message on one side, a Claude Code
// session over the Macro MCP on the other. The point of the pairing is that it
// is deliberately the SAME task in both graphics ("Fix coupon validation at
// pricing step", moved to In Review and assigned to Teo): the section is about
// how far up or down the technical ladder you can work, not about two separate
// features, and two unrelated examples would have muddied that.
//
// Both graphics share a 520x380 artboard so the columns sit at identical heights
// with no per-side juggling. Neither carries an outer window panel: the section
// crops and scales them past their box, bento-style, so a frame would only be a
// border sliding through the fade. See genTaskMockups.py.
// ---------------------------------------------------------------------------

/* The bento's grid line from TasksFeatureCards in RouteTasks.tsx. Its colour is
   pulled out on its own because this section's divider is a rotated element
   rather than a border, so it needs a background-color, not the shorthand. */
const BENTO_LINE_COLOR = 'color-mix(in srgb, var(--b4) 38%, transparent)';

const mobile = () => viewportWidth() < 700;
const stacked = () => viewportWidth() < 900;

type Side = {
  id: string;
  title: string;
  /** Trailing/leading dots that carry the phrase across the divider. Kept out
      of `title` so they can be coloured separately -- as punctuation they
      should recede, and inside the string they inherited the heading's --c1. */
  ellipsis?: 'leading' | 'trailing';
  line: string;
  graphic: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  /** How far the art is blown up inside its box; >1 crops. */
  scale: number;
  /** The point of the ARTBOARD, as a share of its own size, that lands on the
      box's centre. Both are computed from the composition's real coordinates
      (see genTaskMockups.py) rather than eyeballed, so the crop keeps the
      crucial rows clear of the edge fade. */
  focalX: string;
  focalY: string;
};

const sides: Side[] = [
  {
    id: 'channels',
    title: 'Manage tasks in channels',
    ellipsis: 'trailing',
    line: 'Send a message as a task. @Mention an agent to create, update, or close out.',
    graphic: FlexChannels,
    // A real Figma export at 447x325, so these are re-derived from ITS
    // coordinates rather than inherited from the generated artboard this
    // replaced. Its content is a chat panel across the top-left and a task
    // card across the bottom-right, with the meaningful rows running y 18
    // (Gabriel) to y 225 (the activity line) -- centre 121/325 = 37.3%, well
    // above the artboard's middle, because the card's lower half is empty.
    // focalX 44%: the @Macro instruction and the card's title/pills together
    // span x 46-350, centre 198/447 = 44.3%, slightly left of centre.
    scale: 1.32,
    focalX: '45%',
    focalY: '38%',
  },
  {
    id: 'mcp',
    title: 'or through the MCP',
    ellipsis: 'leading',
    line: 'Point your agents at your Macro workspace and drive tasks as tool calls.',
    graphic: FlexMcp,
    // Frames the typed instruction (y 80) through the answer (y 272), centre
    // 176/380 = 46.3%. focalX is 32%, not 50%: the transcript is left-anchored
    // at x 20, so centring the artboard would slice the bullets and the start
    // of every line. This crops 16 units left of the artboard, so the bullet
    // column sits 37 units in and clears the ramp, and lets the one long line
    // (the echoed instruction) run off the right and dissolve instead.
    // Eased from 1.42 for the same reason as the channels side.
    scale: 1.14,
    focalX: '31.1%',
    focalY: '46.3%',
  },
];

export function TasksFlexibility() {
  return (
    <section
      aria-label="Manage tasks in channels or through the MCP"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '26px' : '34px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1160px',
        padding: mobile() ? '64px 18px 72px' : '96px 24px 104px',
        width: '100%',
      }}
    >
      <style>{`
        /* The dots read as punctuation carrying the phrase across the
           divider, not as part of either heading, so they sit at the prose
           grey rather than the heading's --c1. */
        .tfx-ellipsis { color: color-mix(in srgb, var(--c4) 80%, transparent); }
        /* Crop + blow-up, the mechanism .tasks-fig-spot/.tasks-fig-bleed use in
           RouteTasks.tsx: overflow:hidden on the box does the cropping, and the
           art is sized as a multiple of the box width so the framing holds at
           any column width. left/top drop the art's origin on the box centre,
           then the translate pulls the focal point back onto it.
           This is what removes the card edges: at >1 scale the composition's
           outer bounds fall outside the box entirely, so no border is ever in
           frame -- the fade is then working on content, not on a rectangle. */
        .tfx-card { overflow: hidden; position: relative; }
        .tfx-art {
          display: block;
          height: auto;
          left: 50%;
          position: absolute;
          top: 50%;
          transform: translate(calc(-1 * var(--focal-x)), calc(-1 * var(--focal-y)));
          width: calc(var(--art-scale) * 100%);
          /* An svg clips to its viewport by default; nothing is painted outside
             the viewBox here, and the box's own overflow:hidden is what crops. */
          overflow: visible;
        }
        /* One radial layer and nothing else. The previous version paired a
           radial with a shallow linear ramp per axis to guarantee the edges
           reached zero -- but those ramps fade along an axis, which is exactly
           what read as directional. Gone.
           Radii are 50%: the largest a pure radial can be while still reaching
           zero at the box edge midpoints, which is what keeps overflow:hidden
           from clipping a hard line. Larger leaves alpha above zero at the edge
           and clips; smaller is harsher for no benefit.

           The falloff is a smootherstep (6t^5 - 15t^4 + 10t^3) over the radius
           outside a solid 30% core, sampled every 4%. Two properties are doing
           the work, and both are why this reads as gradual with no edge
           anywhere:
             - its FIRST AND SECOND derivatives are zero at both ends of the
               ramp. At r=30% the fade starts from a standstill, so there is no
               ring where the core stops; at r=100% it arrives at zero already
               flat, so there is no edge where overflow:hidden cuts.
             - sampling every 4% keeps consecutive steps under ~0.11 alpha, far
               below where 8-bit interpolation bands.
           A hand-rolled ramp cannot easily have both: the earlier one held high
           alpha far out and then fell off steeply, which kept content bright
           but put a visible knee near the edge.
           Trade-off worth knowing: a symmetric curve is dimmer through the
           mid-radius than that knee'd one was. Pushing the core past ~30% wins
           the brightness back but shortens the ramp until the knee returns;
           dropping it towards 0 is smoother still but washes the content out.
           Bracketed on screen against core 0.06 and the old ramp. */
        .tfx-fade {
          --tfx-mask: radial-gradient(ellipse 50% 50% at 50% 50%,
            #000 0%,
            #000 30%,
            rgba(0, 0, 0, 0.998) 34%,
            rgba(0, 0, 0, 0.988) 38%,
            rgba(0, 0, 0, 0.962) 42%,
            rgba(0, 0, 0, 0.918) 46%,
            rgba(0, 0, 0, 0.855) 50%,
            rgba(0, 0, 0, 0.776) 54%,
            rgba(0, 0, 0, 0.683) 58%,
            rgba(0, 0, 0, 0.580) 62%,
            rgba(0, 0, 0, 0.473) 66%,
            rgba(0, 0, 0, 0.368) 70%,
            rgba(0, 0, 0, 0.269) 74%,
            rgba(0, 0, 0, 0.182) 78%,
            rgba(0, 0, 0, 0.111) 82%,
            rgba(0, 0, 0, 0.058) 86%,
            rgba(0, 0, 0, 0.023) 90%,
            rgba(0, 0, 0, 0.006) 94%,
            rgba(0, 0, 0, 0.000) 98%,
            transparent 100%);
          mask-image: var(--tfx-mask);
          -webkit-mask-image: var(--tfx-mask);
        }
      `}</style>

      {/* A bento row: no gap, and the divider sits on the inner edge of the
          second cell. Unlike the 2x2 bento's, this one is canted, so it cannot
          be a border — a border follows its box. It is a hairline element
          rotated about its own centre instead, which is why the cell below
          needs position: relative. */}
      <div
        style={{
          display: 'grid',
          'grid-template-columns': stacked()
            ? 'minmax(0, 1fr)'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': stacked() ? '520px' : '100%',
          width: '100%',
        }}
      >
        <For each={sides}>
          {(side, i) => (
            <div
              style={{
                'box-sizing': 'border-box',
                display: 'grid',
                gap: mobile() ? '18px' : '22px',
                position: 'relative',
                // Only the INNER side is padded, so the divider gets breathing
                // room while the outer edges stay flush with the heading above.
                // Padding both sides would inset the graphics and break that.
                'padding-block':
                  stacked() && i() === 1
                    ? mobile()
                      ? '44px 0'
                      : '52px 0'
                    : '0',
                'padding-inline': stacked()
                  ? '0'
                  : i() === 0
                    ? '0 34px'
                    : '34px 0',
              }}
            >
              <Show when={i() === 1}>
                <div
                  aria-hidden="true"
                  style={{
                    'background-color': BENTO_LINE_COLOR,
                    position: 'absolute',
                    'transform-origin': 'center',
                    // Rotating a 1px rule spreads it across ~2 device pixels at
                    // partial coverage, so it reads lighter than the bento's
                    // upright ones; BENTO_LINE_COLOR is mixed a few points
                    // stronger than the bento's 32% to land at the same
                    // apparent weight. The vertical rule takes the larger angle
                    // because a small one is imperceptible over its own length.
                    // Both angles are negated from the cant this started with,
                    // which is what a horizontal flip of the rule amounts to:
                    // mirroring about the vertical axis reverses the sign and
                    // nothing else, so the weight and length are untouched.
                    ...(stacked()
                      ? {
                          left: 0,
                          right: 0,
                          top: 0,
                          height: '1px',
                          transform: 'rotate(0.7deg)',
                        }
                      : {
                          bottom: 0,
                          left: '-24px',
                          top: 0,
                          width: '1px',
                          transform: 'rotate(-9.5deg)',
                        }),
                  }}
                />
              </Show>
              <div style={{ display: 'grid', gap: '8px' }}>
                {/* h2, not h3: the section-level h2 is gone, so these are its
                    top-level headings and an h3 here would skip a level. */}
                <h2 class="tasks-h3">
                  <Show when={side.ellipsis === 'leading'}>
                    <span class="tfx-ellipsis">...</span>
                  </Show>
                  {side.title}
                  <Show when={side.ellipsis === 'trailing'}>
                    <span class="tfx-ellipsis">...</span>
                  </Show>
                </h2>
                {/* sub, not caption: these follow a .tasks-h3 column title. */}
                <p
                  class="tasks-sub"
                  style={{ 'max-width': '46ch', 'text-wrap': 'pretty' }}
                >
                  {side.line}
                </p>
              </div>
              {/* No drop shadow and no glow behind these two, unlike the rest
                  of the page: a shadow is cast from the unmasked box (filter
                  runs before mask), so it would outline a crisp rectangle under
                  art whose edges have just been dissolved -- reinstating the
                  card edge the fade exists to remove. The bento's own figs
                  carry neither. */}
              <div
                class="tfx-card tfx-fade"
                style={{
                  // Box aspect matches the artboard's, so --art-scale crops by
                  // the same factor on both axes and the focal maths above
                  // holds in one number instead of two.
                  'aspect-ratio': '520 / 380',
                  width: '100%',
                  '--art-scale': side.scale,
                  '--focal-x': side.focalX,
                  '--focal-y': side.focalY,
                }}
              >
                <Dynamic
                  component={side.graphic}
                  class="tfx-art"
                  aria-hidden="true"
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
