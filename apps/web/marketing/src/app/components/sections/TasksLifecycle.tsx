import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { createVisible } from '../../utils/utilVisible';
import {
  CYCLE,
  MOBILE_ASPECT,
  PHASES,
  TasksLifecycleScene,
} from './TasksLifecycleScene';
import '../../routes/RouteTasks.css';

// ---------------------------------------------------------------------------
// The lifecycle of a Macro task — one continuous animated scene, driven by a
// clock this section owns.
//
// The scene (TasksLifecycleScene) is a pure function of `t`, milliseconds
// into a CYCLE. This file advances `t` with a single requestAnimationFrame
// loop accumulating real dt (not setInterval, which drifts and keeps running
// in background tabs) and maps `t` onto the four-step stepper: the active
// step is the last phase whose start is behind the clock, and the fill bar is
// how far through that phase the clock is.
//
// Controls. A step click seeks the clock to that phase's start and lets it
// play up to the phase's `rest` -- the frame that stands for the phase -- then
// holds there. Holding at the rest rather than pausing on the spot is the
// point: with an animated scene, "pause where the user clicked" would freeze
// a half-typed sentence or a cursor in mid-air. The play button resumes the
// free-running loop. Reduced motion starts held on the first phase's rest
// frame and makes step clicks jump straight between rest frames; play still
// animates, because it is an explicit choice.
//
// The loop only runs while the frame is on screen (createVisible), and the
// clock starts from 0 when JS arrives so the story begins at the top when the
// section scrolls into view. The server renders PHASES[0].rest -- the issue
// typed and the toggle about to be pressed -- rather than an empty composer.
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;
const compact = () => viewportWidth() < 1000;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function TasksLifecycle(props: {
  embedded?: boolean;
  title?: JSX.Element;
  description?: JSX.Element;
}) {
  const [t, setT] = createSignal(PHASES[0].rest);
  const [paused, setPaused] = createSignal(false);
  /** When set, the loop stops and pauses as the clock reaches this value.
      May exceed CYCLE, meaning "the rest after the next wrap". */
  let holdAt: number | null = null;
  let frameEl: HTMLDivElement | undefined;

  const visible = createVisible(() => frameEl, '120px');
  const reduce = () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const active = createMemo(() => {
    let i = 0;
    for (let k = 0; k < PHASES.length; k++) if (t() >= PHASES[k].start) i = k;
    return i;
  });
  /** How far through the phase's own story -- measured to its rest frame, not
      to where the next phase begins. Those differ because every phase holds on
      its rest for a beat before handing over, and that tail is dead time. Timed
      against the tail, the bar stopped short of its end everywhere a step click
      held it: 2% short on phase 1, but 26% short on phase 4, which read as the
      bar being broken rather than as the phase having a tail. Clamped, so it
      sits full through the tail instead. */
  const progress = () => {
    const p = PHASES[active()];
    return clamp01((t() - p.start) / (p.rest - p.start));
  };

  /** Seek to a phase and play it through to its rest frame. */
  const select = (index: number) => {
    const p = PHASES[index];
    if (reduce()) {
      setT(p.rest);
      holdAt = null;
      setPaused(true);
      return;
    }
    setT(p.start);
    holdAt = p.rest;
    setPaused(false);
  };

  /** Anything else the user does inside the section -- clicking the graphic,
      tabbing in -- lets the current phase finish and then holds. Guarded on
      the play/pause control (so pressing Play does not immediately re-hold)
      and on the tabs (select() handles those). */
  const takeControl = (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('[data-tlc-play], [role=tab]')) return;
    if (paused()) return;
    const i = active();
    const rest = PHASES[i].rest;
    if (t() < rest) holdAt = rest;
    else if (i + 1 < PHASES.length) holdAt = PHASES[i + 1].rest;
    else holdAt = CYCLE + PHASES[0].rest;
  };

  const togglePlay = () => {
    if (paused()) {
      // Play means run freely: drop any pending hold from a step click.
      holdAt = null;
      setPaused(false);
    } else {
      setPaused(true);
    }
  };

  onMount(() => {
    if (reduce()) setPaused(true);
    else setT(0);
  });

  // The loop exists only while it is actually running, so pausing (or
  // scrolling the section away) cancels the rAF outright, and resuming
  // re-seeds `last` -- otherwise the first frame back would bill the whole
  // idle interval to a single step.
  createEffect(() => {
    if (paused() || !visible()) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // Clamp dt. The first frame after mount, and the first after a
      // backgrounded tab resumes firing rAF, can carry a delta of hundreds of
      // ms -- unclamped that skips beats outright.
      const dt = Math.min(now - last, 64);
      last = now;
      const raw = untrack(t) + dt;
      if (holdAt !== null && raw >= holdAt) {
        setT(holdAt >= CYCLE ? holdAt - CYCLE : holdAt);
        holdAt = null;
        setPaused(true);
        return;
      }
      setT(raw >= CYCLE ? raw - CYCLE : raw);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  /** Sits to the left of the progress bar (and of the chips on narrow), so the
      rotation always has a visible, reversible off switch. Deliberately outside
      the [role=tablist] -- a tablist's children are supposed to be tabs. */
  const PlayPause = (props: { size: number }) => (
    <button
      type="button"
      data-tlc-play="1"
      class="tlc-play"
      aria-label={
        paused()
          ? 'Play the lifecycle walkthrough'
          : 'Pause the lifecycle walkthrough'
      }
      onClick={togglePlay}
      style={{
        'align-items': 'center',
        background: 'none',
        border: '1px solid color-mix(in srgb, var(--b4) 30%, transparent)',
        'border-radius': '999px',
        color: 'var(--c2)',
        cursor: 'pointer',
        display: 'inline-flex',
        flex: 'none',
        height: `${props.size}px`,
        'justify-content': 'center',
        padding: 0,
        width: `${props.size}px`,
      }}
    >
      <Show
        when={paused()}
        fallback={
          <svg
            width="9"
            height="10"
            viewBox="0 0 9 10"
            aria-hidden="true"
            style={{ display: 'block' }}
          >
            <rect
              x="0"
              y="0"
              width="3"
              height="10"
              rx="1"
              fill="currentColor"
            />
            <rect
              x="6"
              y="0"
              width="3"
              height="10"
              rx="1"
              fill="currentColor"
            />
          </svg>
        }
      >
        {/* Nudged a touch right of centre: a triangle's visual centre of mass
            sits left of its bounding box, so a centred one reads off-centre. */}
        <svg
          width="9"
          height="10"
          viewBox="0 0 9 10"
          aria-hidden="true"
          style={{ display: 'block', 'margin-left': '1.5px' }}
        >
          <path
            d="M0.6 0.9v8.2a.5.5 0 0 0 .77.42l6.4-4.1a.5.5 0 0 0 0-.84L1.37.48A.5.5 0 0 0 .6.9Z"
            fill="currentColor"
          />
        </svg>
      </Show>
    </button>
  );

  return (
    <section
      aria-label="The lifecycle of a Macro task"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '14px' : '18px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1160px',
        'padding-block': props.embedded
          ? '0'
          : mobile()
            ? '64px 72px'
            : '96px 104px',
        'padding-inline': props.embedded ? '0' : mobile() ? '18px' : '24px',
        width: '100%',
      }}
      onClick={takeControl}
      onFocusIn={takeControl}
    >
      <style>{`
        /* The stage frame, lifted verbatim from .email-filter-frame in
           EmailFilteringSection.tsx (the email page's second hero): a masked
           1px gradient ring that paints ONLY the ring, never behind the
           content, so it stays independent of the frame's semi-transparent
           fill and reads a touch lighter than it.
           One deviation: z-index 2. The email page's mockup is an unpositioned
           child, so the ring paints over it for free; our stage is a
           positioned box, which would otherwise cover the ring on its flush
           left/right/bottom edges. */
        .tlc-frame { position: relative; }
        .tlc-frame::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          /* Tracks the fill above: brightened, and run to the bottom edge so
             the ring does not fade out while the fill is still lit -- which
             read as the frame losing its left and right edges halfway down. */
          background: linear-gradient(to bottom, color-mix(in srgb, var(--c1) 14%, transparent) 0%, color-mix(in srgb, var(--c1) 9%, transparent) 45%, transparent 100%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 2;
        }
        /* The narrow stepper: dots on a rail, the active one grown into its
           label. Transitions rather than clock ramps because these track a
           DOM state (which tab is selected), not the scene's t. */
        .tlc-rail { align-items: center; display: flex; flex: 1 1 0; min-width: 0; }
        .tlc-link { background: color-mix(in srgb, var(--b4) 22%, transparent); flex: 1 1 0; height: 1px; min-width: 4px; overflow: hidden; }
        .tlc-link-fill {
          background: color-mix(in srgb, var(--b4) 60%, transparent);
          display: block;
          height: 1px;
          transform-origin: 0 50%;
          transition: transform 320ms ease;
          width: 100%;
        }
        .tlc-node {
          align-items: center;
          background: transparent;
          border: 1px solid color-mix(in srgb, var(--b4) 22%, transparent);
          border-radius: 999px;
          color: var(--c4);
          cursor: pointer;
          display: flex;
          /* The dots hold their size; the one pill is what gives when the
             longest label ("Responsive updates") plus three dots plus three
             links will not fit a 320px phone. It ellipsises rather than
             pushing the rail into an overflow. */
          flex: none;
          font-family: rajdhani, body;
          font-size: 12px;
          font-weight: 700;
          gap: 0;
          height: 26px;
          letter-spacing: 0.06em;
          /* 10 + the 6px dot + 10 is 26, so an unselected node is a circle
             rather than a stadium one pixel off being one. */
          padding: 0 10px;
          text-transform: uppercase;
          transition: background 200ms ease, border-color 200ms ease, color 200ms ease, gap 300ms ease, padding 260ms ease;
        }
        .tlc-node[aria-selected='true'] {
          background: color-mix(in srgb, var(--c1) 12%, transparent);
          border-color: color-mix(in srgb, var(--b4) 44%, transparent);
          color: var(--c1);
          /* The dot-to-label gap is the node's own gap, not padding on the
             label: padding does not collapse with a 0fr track, so it would
             leave every unselected node 7px wider than the dot it holds. */
          flex: 0 1 auto;
          gap: 7px;
          min-width: 0;
          padding: 0 11px;
        }
        .tlc-dot { background: currentColor; border-radius: 999px; flex: none; height: 6px; width: 6px; }
        /* 0fr -> 1fr is the animatable form of "grow to fit the text". */
        .tlc-node-label { display: grid; grid-template-columns: 0fr; opacity: 0; transition: grid-template-columns 300ms ease, opacity 200ms ease; }
        .tlc-node[aria-selected='true'] .tlc-node-label { grid-template-columns: 1fr; opacity: 1; }
        .tlc-node-label > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* Small phones: the longest label ("Responsive updates") needs about
           25px more than a 320px rail has once the three dots and their links
           are paid for. Taken off the padding, the links, and a point of type
           rather than off the label, which would ellipsise. */
        @media (max-width: 380px) {
          .tlc-link { min-width: 2px; }
          .tlc-node { font-size: 11px; padding: 0 8px; }
          .tlc-node[aria-selected='true'] { padding: 0 8px; }
        }

        .tlc-step { transition: color 160ms ease, border-color 220ms ease; }
        .tlc-play { transition: color 160ms ease, border-color 160ms ease; }
        @media (hover) {
          .tlc-step:hover .tlc-step-title { color: var(--c1); }
          .tlc-node:hover { color: var(--c2); }
          .tlc-play:hover {
            border-color: color-mix(in srgb, var(--b4) 58%, transparent);
            color: var(--c1);
          }
        }
      `}</style>

      {/* Header, ranged left over the stage — same treatment as the case
          studies and comparison sections.
          The three blocks in this section (header, stage, stepper) fill the
          section's content box rather than being capped narrower than it.
          They were capped at 1000px inside a 1112px box, and because
          justify-self pins them left, the whole 112px surplus collected on the
          right: 2px of apparent padding on one side against 125px on the
          other. Filling the box makes this row measure the same either side as
          the flexibility and autopilot rows. */}
      <Show when={!props.embedded}>
        <div
          style={{
            'justify-self': 'start',
            'margin-bottom': mobile() ? '24px' : '72px',
            'max-width': '100%',
            'text-align': 'left',
            width: '100%',
          }}
        >
          <h2 class="tasks-h2">
            {props.title ?? (
              <>
                Tasks that live <br /> with your work.
              </>
            )}
          </h2>
          {/* lead, not sub: this follows a .tasks-h2. The space under a 48px
            slab title is set from the title rather than from the paragraph:
            at 12 it sat closer to the heading than the heading's own two
            lines sit to each other, which read as one block rather than a
            title and a line about it. */}
          <p
            class="tasks-lead"
            style={{
              margin: mobile() ? '16px 0 0' : '22px 0 0',
              'max-width': '600px',
            }}
          >
            {props.description ??
              'Create, update, and close, in whichever way suits your workflow.'}
          </p>
        </div>
      </Show>

      {/* The stage. A fixed aspect box so nothing the scene does can change
          the section's height — the scene is laid out at 880x402 and zoomed to
          fit. justify-self flushes it to the same left edge as the header
          above, instead of centering independently in the section's wider
          track. */}
      <div
        ref={frameEl}
        class="tlc-frame"
        style={{
          // Top-lit gradient fill + 8px radius, the same values
          // .email-filter-frame uses. No padding of its own: the scene keeps
          // its own 62-unit margins to the frame, so the frame hugging the
          // scene is exactly what makes the gap read even across top, left
          // and right. Padding here would stack on top of that margin and
          // unbalance it again.
          // Two lights. The key light is the neutral top wash below; this
          // first layer is a secondary bounce warming the lower-right corner,
          // which the key light has all but given up on by that point.
          // Its colour is the midpoint between the brand orange --a0 and the
          // neutral --c1 the key light uses. Those two already share a hue
          // (44deg) -- --c1 is simply that hue at zero chroma -- so mixing in
          // OKLCH moves along chroma alone, landing on 0.115 with the hue
          // untouched. That is why it reads as the same light going warm
          // rather than as a second colour entering the frame. (Mixing in srgb
          // instead would drag the result off-hue and muddy it.)
          // 7% is the bottom end of visible. Bracketed against 5 and 14 at full
          // orange -- 5 all but vanished once the frame scaled down, and by 14
          // it had stopped being a bounce and read as a coloured spotlight
          // aimed at the corner. First layer, so it sits ON TOP of the wash.
          background:
            'radial-gradient(ellipse 62% 58% at 100% 100%,' +
            ' color-mix(in srgb, color-mix(in oklch, var(--ambient-ink), var(--ambient-ink)) 7%, transparent) 0%,' +
            ' color-mix(in srgb, color-mix(in oklch, var(--ambient-ink), var(--ambient-ink)) 3%, transparent) 38%,' +
            ' transparent 72%),' +
            'linear-gradient(to bottom,' +
            ' color-mix(in srgb, var(--c1) 34%, transparent) 0%,' +
            ' color-mix(in srgb, var(--c1) 13%, transparent) 45%,' +
            ' color-mix(in srgb, var(--c1) 5%, transparent) 78%,' +
            ' transparent 100%)',
          'border-radius': '8px',
          'box-sizing': 'border-box',
          'justify-self': 'start',
          'max-width': '100%',
          width: '100%',
        }}
      >
        <div
          id="tlc-stage"
          style={{
            // The phone camera looks at a window onto the artboard rather
            // than the whole of it, so the box it fills is not the artboard's
            // shape. See MOBILE_ASPECT in the scene.
            'aspect-ratio': mobile() ? `${MOBILE_ASPECT}` : '880 / 402',
            // The clip that lets the channel thread run off the top edge.
            // Radius matched to .tlc-frame (which has no padding, so the two
            // boxes coincide) so the cut follows the frame's rounded corners
            // instead of squaring them off.
            'border-radius': '8px',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          <TasksLifecycleScene t={t} />
        </div>
      </div>

      {/* Controls. Desktop gets the full stepper with blurbs; narrow gets a
          rail of nodes plus a live-announced blurb, so the copy is never
          lost. */}
      <Show
        when={!compact()}
        fallback={
          <div
            style={{
              display: 'grid',
              gap: '14px',
              'justify-items': 'center',
              'margin-top': mobile() ? '20px' : '26px',
              width: '100%',
            }}
          >
            {/* One row, not two. Four labelled chips wrapped onto a second
                line and cost about 60px of height for chrome; as a rail of
                dots only the one you are on needs a name, and the line
                between them says they are a sequence, which four loose pills
                never did. */}
            <div
              style={{
                'align-items': 'center',
                display: 'flex',
                gap: '10px',
                width: '100%',
              }}
            >
              <PlayPause size={26} />
              <div
                class="tlc-rail"
                role="tablist"
                aria-label="Task lifecycle stages"
              >
                <For each={PHASES}>
                  {(phase, i) => (
                    <>
                      {/* The link into this node, carrying the progress: full
                          behind the phases already played, filling across the
                          one running, empty ahead. */}
                      <Show when={i() > 0}>
                        <span aria-hidden="true" class="tlc-link">
                          <span
                            class="tlc-link-fill"
                            style={{
                              transform: `scaleX(${i() <= active() ? 1 : 0})`,
                            }}
                          />
                        </span>
                      </Show>
                      <button
                        class="tlc-node"
                        role="tab"
                        type="button"
                        aria-selected={active() === i()}
                        aria-controls="tlc-stage"
                        onClick={() => select(i())}
                      >
                        <span aria-hidden="true" class="tlc-dot" />
                        {/* Two nested spans: the outer is a 0fr -> 1fr grid
                            track, which is what makes the width animate at
                            all (a width of `auto` does not), and the inner is
                            the thing being clipped to it. */}
                        <span class="tlc-node-label">
                          <span>{phase.title}</span>
                        </span>
                      </button>
                    </>
                  )}
                </For>
              </div>
            </div>
            <p
              aria-live="polite"
              style={{
                color: 'var(--c4)',
                'font-family': 'body',
                'font-size': '15px',
                'line-height': 1.5,
                margin: 0,
                'max-width': '420px',
                'text-align': 'center',
              }}
            >
              {PHASES[active()].blurb}
            </p>
          </div>
        }
      >
        <div
          style={{
            // flex-start + a half-height negative margin on the control puts
            // its centre exactly on the rule, so it reads as a transport
            // control sitting on the timeline rather than floating above it.
            'align-items': 'flex-start',
            display: 'flex',
            gap: '18px',
            'justify-self': 'start',
            margin: '48px 0 0',
            'max-width': '100%',
            width: '100%',
          }}
        >
          <div style={{ 'margin-top': '-15px' }}>
            <PlayPause size={30} />
          </div>
          <ol
            role="tablist"
            aria-label="Task lifecycle stages"
            style={{
              'border-top':
                '1px solid color-mix(in srgb, var(--b4) 20%, transparent)',
              display: 'grid',
              'grid-template-columns': `repeat(${PHASES.length}, minmax(0, 1fr))`,
              'list-style': 'none',
              margin: 0,
              'min-width': 0,
              padding: 0,
              width: '100%',
            }}
          >
            <For each={PHASES}>
              {(phase, i) => (
                <li style={{ 'min-width': 0 }}>
                  <button
                    class="tlc-step"
                    role="tab"
                    type="button"
                    aria-selected={active() === i()}
                    aria-controls="tlc-stage"
                    onClick={() => select(i())}
                    style={{
                      background: 'none',
                      border: 'none',
                      // The active step is marked by a rule that fills as the
                      // clock moves through the phase, which doubles as the
                      // progress indicator.
                      'border-top': '2px solid transparent',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: '7px',
                      'justify-items': 'start',
                      'margin-top': '-1px',
                      padding: mobile() ? '16px 14px 0 0' : '20px 26px 0 0',
                      position: 'relative',
                      'text-align': 'left',
                      width: '100%',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        background:
                          active() === i() ? 'var(--c1)' : 'transparent',
                        height: '2px',
                        left: 0,
                        position: 'absolute',
                        top: '-2px',
                        // No transition: the rAF loop already sets this every
                        // frame, so a transition would restart on each one and
                        // the bar would permanently chase a target it never
                        // reaches.
                        width: active() === i() ? `${progress() * 100}%` : '0%',
                      }}
                    />
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': 'rajdhani, body',
                        'font-size': '11.5px',
                        'font-variant-numeric': 'tabular-nums',
                        'font-weight': '700',
                        'letter-spacing': '0.1em',
                      }}
                    >
                      {String(i() + 1).padStart(2, '0')}
                    </span>
                    <span
                      class="tlc-step-title"
                      style={{
                        color: active() === i() ? 'var(--c1)' : 'var(--c2)',
                        'font-family': 'display',
                        'font-size': '18px',
                        'font-weight': '410',
                        'letter-spacing': '-0.01em',
                        'line-height': 1.15,
                        transition: 'color 160ms ease',
                      }}
                    >
                      {phase.title}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': 'body',
                        'font-size': '14px',
                        'line-height': 1.45,
                        opacity: active() === i() ? 1 : 0.62,
                        'text-wrap': 'pretty',
                        transition: 'opacity 220ms ease',
                      }}
                    >
                      {phase.blurb}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ol>
        </div>
      </Show>
    </section>
  );
}
