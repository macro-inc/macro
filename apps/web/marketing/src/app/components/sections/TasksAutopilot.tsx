import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { CARD_H, CARD_W, TaskCard, TaskCardStyles } from '../graphics/TaskCard';
import '../../routes/RouteTasks.css';
import EmptyStateCalls from '../../../assets/graphics/empty-state-calls.svg';
import { type TaskTeam as Team, taskTeams as teams } from './TasksTeamBoards';

// ---------------------------------------------------------------------------
// Closing hero — one line over three real tasks, one per team. Its headline
// treatment (the clamped display size, the -0.015em tracking, the two-block
// h2) is carried over from the "Tasks should guide the work" hero this
// section replaced, so the page's closing rhythm is unchanged.
//
// The graphic is three TaskCards — the same panel the lifecycle section's
// third phase shows — dealt left to right in an overlapping stair rather than
// sat in three separate cells. Overlapping is the point: three tasks from
// three teams in one object says "one system" in a way three tidy columns of
// bespoke board art did not.
//
// Geometry. The stair is laid out in a fixed FAN_W x FAN_H design space and
// `zoom`ed to whatever width the section has, so every offset below is a
// literal and the cards keep their proportions at any viewport. `zoom` rather
// than transform because it reflows: text is laid out at its final size and
// stays crisp. The caption row underneath is a percentage grid cut on the same
// column edges, so each team's name sits under the left edge of its own card.
// A phone gets the stack alone: the cards are dealt almost on top of each
// other, so there are no edges left for names to sit under, and three columns
// of body copy at a third of 375px turned the section into a wall of text.
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;
/** Where the heading row gives up its second column (the empty-state
    illustration). Nothing to do with the stair, which runs at every
    width. */
const stacked = () => viewportWidth() < 1000;

/** The stair's design space, and the three cards' top-left corners in it.
    The x step is CARD_W less the overlap; the last card's right edge is the
    space's width, so FAN_W follows from the steps rather than being typed.

    The stair is always scaled to fill the section's content width, so a card
    renders wider only by taking a bigger share of FAN_W -- growing CARD_W and
    the step together is a pure scale and changes nothing on screen. That is
    also why the phone gets a much shorter step: at 339px of content the only
    way to draw a card of any size is to let the three of them sit almost on
    top of each other. Dense is not a compromise there, it is the mechanism.
    The y step grows to match, so a deck overlapped four fifths still reads as
    three cards rather than one with a thick edge. */
const STEP_X = () => (mobile() ? 95 : 278);
const STEP_Y = () => (mobile() ? 58 : 26);
const FAN_W = () => STEP_X() * 2 + CARD_W;
const FAN_H = () => STEP_Y() * 2 + CARD_H;

/** Widths of the caption columns, cut on the card edges -- one x-step, one
    x-step, a whole card -- so each name sits under its own card. Only ever
    used off a phone, which has no captions. */
const CAPTION_COLS = () =>
  `${((STEP_X() / FAN_W()) * 100).toFixed(3)}% ${((STEP_X() / FAN_W()) * 100).toFixed(3)}% ${((CARD_W / FAN_W()) * 100).toFixed(3)}%`;

/** First guess at the row's width, for the prerender and for the frame before
    the observer reports. Only a guess on purpose: the section's own padding is
    not the whole story -- the route wraps it in a further 12px gutter -- so
    the row is measured rather than derived. Getting that wrong is what had the
    stair running 24px past the section's right edge.

    The stair fills whatever it is given: its outer card edges line up with the
    heading and the lead above it, and at the 1160 max-width that means scaling
    up by about 1.1 -- fine, since `zoom` relays the type at its new size
    rather than resampling it. */
const seedRowW = () => Math.min(viewportWidth(), 1160) - (mobile() ? 60 : 48);

/** The team's name and line, used under a card in both layouts. Positioned so
    it paints after the card above it: .tcp-card is position: relative, which
    alone is enough to put it in a later paint step than a static block and
    drop its shadow across this text. */
const Caption = (p: { team: Team }) => (
  <div style={{ display: 'grid', gap: '6px', position: 'relative' }}>
    <h3
      style={{
        color: 'var(--c1)',
        'font-family': 'display',
        // Measured: "Engineering" runs 5.74x its font size, so 17.2% of the
        // column is the largest that still fits it on one line. Capped at the
        // 19px it used to be fixed at, floored so it never gets silly; on a
        'font-size': '21px',
        'font-weight': '315',
        'letter-spacing': '-0.01em',
        'line-height': 1.2,
        margin: 0,
      }}
    >
      {p.team.name}
    </h3>
    <p
      class="tasks-caption"
      style={{ 'max-width': '34ch', 'text-wrap': 'pretty' }}
    >
      {p.team.line}
    </p>
  </div>
);

export function TasksAutopilot() {
  /** The row the stair is drawn across, measured. See seedRowW. */
  const [rowW, setRowW] = createSignal(seedRowW());
  let rowEl: HTMLDivElement | undefined;
  onMount(() => {
    if (!rowEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      if (w > 0) setRowW(w);
    });
    ro.observe(rowEl);
    onCleanup(() => ro.disconnect());
  });
  const fanScale = () => rowW() / FAN_W();

  return (
    <section
      aria-label="Put tasks on autopilot for your whole team"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        // The copy sat 68.7px off the team cards, which read as crowding them.
        // That was first fixed by trading top padding for gap at constant
        // section height (-24px top / +24px gap on desktop, -16/+24 on a
        // phone), and the gap has since been opened a further 48 on desktop /
        // 32 on a phone. That last step is NOT a trade -- the padding stays
        // put, so the section is that much taller now. Deliberate: taking it
        // out of the top padding instead would have pulled the heading up
        // towards the section above rather than pushing the cards down.
        // The ceiling is the section's own bottom padding (96): once the gap
        // approaches it the cards stop reading as belonging to this heading
        // and start reading as belonging to whatever follows.
        gap: mobile() ? '96px' : '136px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1160px',
        padding: mobile() ? '56px 18px 64px' : '88px 24px 96px',
        width: '100%',
      }}
    >
      <TaskCardStyles />
      <div
        style={{
          'align-items': 'center',
          display: 'grid',
          gap: stacked() ? '40px' : '48px',
          'grid-template-columns': stacked()
            ? 'minmax(0, 1fr)'
            : 'minmax(0, 1fr) auto',
          'justify-self': 'start',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: mobile() ? '28px' : '36px',
            'justify-items': 'start',
            width: '100%',
          }}
        >
          <h2
            class="tasks-h2"
            style={{ 'text-align': 'left', 'text-wrap': 'balance' }}
          >
            {/* Two tones, bright-then-dim: the statement leads at full strength
              and the qualifier recedes. The bright half stays at --c1 rather
              than pure --c0 because every other heading on the page tops out
              at --c1, and outshining them would make this section read as a
              different level in the hierarchy.
              The dim half needs a wide gap to register at 52px -- this page
              compresses the grey ramp (c1 232, c2 222, c3 212 in luminance),
              so the neighbouring steps are invisible at a glance. --c4 (174)
              is the widest drop the ramp offers before the text stops reading
              as a heading at all. */}
            <span style={{ color: 'var(--c1)', display: 'block' }}>
              Put tasks on autopilot
            </span>
            <span
              style={{
                color: 'var(--c4)',
                display: 'block',
                'margin-top': '0.16em',
              }}
            >
              for your whole team.
            </span>
          </h2>
          <p
            class="tasks-lead"
            style={{
              'max-width': '60ch',
              'text-align': 'left',
              'text-wrap': 'pretty',
            }}
          >
            Deeply integrated with chat. <br />
            The perfect balance of technical and intuitive. <br />
            Ideal for collaboration between sales, product, and engineering.
          </p>
        </div>

        {/* The product's own calls empty state, ported from the Macro repo
            (apps/web/src/lib/design/empty-state-calls.svg). Two hooks the whole
            empty-state family expects from its host, the same pair
            EmptyInboxTray.tsx documents: strokes draw with currentColor, and the
            card faces fill with var(--color-surface) -- left unset, those faces
            render transparent and the back edges show through the silhouette.
            Surface is --b0 here because this section sits on the page ground,
            not on a raised panel.
            Hidden rather than stacked below the copy on narrow: it is
            decorative, and stacking it would push the three team cards a screen
            further down. aria-hidden for the same reason -- it carries no
            information the copy does not already state. */}
        <Show when={!stacked()}>
          <div
            aria-hidden="true"
            style={{
              'aspect-ratio': '38.6 / 34.4',
              color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
              '--color-surface': 'var(--b0)',
              'justify-self': 'end',
              // Nudged down by transform rather than margin/padding on purpose:
              // this graphic is the taller of the row's two columns, so it sets
              // the row height. A margin would grow the row and push the team
              // cards down with it; a transform moves only the paint.
              transform: 'translateY(16px)',
              width: 'clamp(210px, 21vw, 290px)',
            }}
          >
            <EmptyStateCalls
              style={{ display: 'block', height: '100%', width: '100%' }}
            />
          </div>
        </Show>
      </div>

      {/* The stair, at every width -- only how densely it is dealt changes. */}
      <div
        ref={rowEl}
        /* The box the observer measures -- and it has to be told its width
           comes from the track, not from what it holds. The stair inside is
           FAN_W px wide before its own `zoom` scales it down, so without
           inline-size containment that intrinsic 680--1046px inflates the
           section's auto track and the stack runs off the side of a phone. */
        style={{
          'container-type': 'inline-size',
          display: 'grid',
          gap: '44px',
          'justify-self': 'stretch',
        }}
      >
        <div
          style={{
            height: `${FAN_H()}px`,
            // Contains the cards' z-indices. Without it they compete with
            // the caption row below in the section's own stacking context
            // and win on z-index however far down the DOM the captions sit,
            // dropping the cards' shadows across the caption text.
            isolation: 'isolate',
            position: 'relative',
            width: `${FAN_W()}px`,
            zoom: fanScale(),
          }}
        >
          {/* One pool of light under the whole stack, in the construction used
              elsewhere on this page: the layer IS the glow's extent, so the
              falloff lands on its own edge and cannot be clipped. Previously
              there was one of these per card; the stack is a single object
              now, so it gets a single pool. */}
          <div
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(50% 50% at 50% 50%,' +
                ' color-mix(in srgb, var(--ambient-ink) 6%, transparent) 0%,' +
                ' color-mix(in srgb, var(--ambient-ink) 3.4%, transparent) 48%,' +
                ' transparent 100%)',
              height: '150%',
              left: '-10%',
              'pointer-events': 'none',
              position: 'absolute',
              top: '-25%',
              width: '120%',
              'z-index': 0,
            }}
          />
          <For each={teams}>
            {(team, i) => (
              <div
                style={{
                  left: `${i() * STEP_X()}px`,
                  position: 'absolute',
                  top: `${i() * STEP_Y()}px`,
                  // Dealt left to right, so each card lands on the one before
                  // it and the stack has a single reading direction.
                  'z-index': i() + 1,
                }}
              >
                <TaskCard task={team.task} />
              </div>
            )}
          </For>
        </div>
        <Show when={!mobile()}>
          <div
            style={{
              'align-items': 'start',
              display: 'grid',
              'grid-template-columns': CAPTION_COLS(),
              // Positioned so it paints after the stair. The stair's cards are
              // absolutely positioned inside a `zoom`ed box -- a stacking context
              // -- which puts them in a later paint step than an ordinary in-flow
              // block however far down the DOM that block sits, so without this
              // the cards' shadows fall across the captions and dim them.
              position: 'relative',
              width: '100%',
            }}
          >
            <For each={teams}>
              {(team, i) => (
                <div
                  style={{
                    // Each caption follows its own card down the stair, so the
                    // distance from a card's bottom edge to its caption is the
                    // same for all three. Rendered px, not design px: the
                    // caption row sits outside the `zoom`ed stair, so the step
                    // has to be scaled by hand to stay in register with it.
                    'margin-top': `${(i() * STEP_Y() * fanScale()).toFixed(1)}px`,
                    'padding-right': '30px',
                  }}
                >
                  <Caption team={team} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
