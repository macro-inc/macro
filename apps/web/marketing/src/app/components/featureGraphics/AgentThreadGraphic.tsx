import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconCall from '../../../assets/icons/chat-scene/call.svg';
import IconHash from '../../../assets/icons/chat-scene/channel-hash.svg';
import IconMenuAutomation from '../../../assets/icons/chat-scene/menu-automation.svg';
import IconMenuChat from '../../../assets/icons/chat-scene/menu-open-in-chat.svg';
import IconMenuSkill from '../../../assets/icons/chat-scene/menu-skill.svg';
import IconTaskGlyph from '../../../assets/icons/chat-scene/task-glyph.svg';
import IconTaskPriority from '../../../assets/icons/chat-scene/task-priority.svg';
import IconTaskStatus from '../../../assets/icons/chat-scene/task-status-progress.svg';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJacob from '../../../assets/people/jacob-work.webp';
import avatarTeo from '../../../assets/people/teo.webp';
import { createVisible } from '../../utils/utilVisible';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

// ---------------------------------------------------------------------------
// @mention an agent — a thread playing out: Jacob asks the agent to catch him
// up, the agent works and answers, and the answer is turned into a skill.
//
// Same mechanism as ChannelPreviewGraphic and ChannelCohesionGraphic before
// it: everything on screen is a pure function of the clock `t`, with no
// timers or transitions in the markup, only `prog(a, b)` ramps. What differs
// is that this one LOOPS. The preview graphic settles into a state you read,
// so it plays once; this is a story with an ending, and a loop is what lets
// someone arriving mid-way see the beginning.
//
// Geometry is the Figma frame's own (file IOH8EtjS7V8rmxnbJzFZ2A, node
// 565:8017) at 523x224, `zoom`ed to the measured width — so every number below
// is the design's, and `zoom` rather than `transform` because it reflows and
// keeps the 10px type crisp.
// ---------------------------------------------------------------------------

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const STAGE_W = 523;
/** How far the menu hangs below the window, from the frame: its bottom sits
    on the board's bottom edge at 224 while the window ends at 187.8. Reserved
    as padding rather than baked into a fixed board height, so the thread can
    grow without anyone having to re-measure the board. */
const MENU_DROP = 36;

const TL = {
  cycle: 14600,
  /** Jacob's message rises in, then its @Macro chip lights. */
  askIn: 600,
  askEnd: 1050,
  mentionLit: 1250,
  /** The elbow draws down to the agent, which arrives working. */
  elbowIn: 1500,
  elbowEnd: 2000,
  agentIn: 1900,
  /** "summarizing…" gives way to the count, and the answer builds a line at
      a time — the part that has to read as the agent composing rather than
      a block of text appearing. */
  workEnd: 3100,
  lead: 3250,
  bullet: 3650,
  bulletStep: 480,
  chip: 5300,
  /** Jacob hands the task back, and the agent takes it. A second working
      beat, shorter than the first: the answer is an acknowledgement, not a
      summary, so it should not look like the same amount of thinking. */
  ask2In: 6200,
  agent2In: 7100,
  work2End: 8000,
  reply2: 8150,
  /** The menu, then the skill: hovered first, then chosen. */
  menuIn: 9100,
  menuEnd: 9450,
  hover: 10100,
  lit: 11000,
  /** Hold on the finished frame, then clear for the next pass. */
  outStart: 13200,
  outEnd: 13800,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
/** Slower in and out, for things that travel rather than just appear. */
const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

/*
 * The thread connector: a vertical drop into a quarter-circle turn.
 *
 * Drawn here rather than imported because it is geometry, not artwork, and
 * the two graphics need it at different proportions. The preview graphic's
 * asset is 20.75x78 and this span is 24.5x43.5 -- scaling that box to fit
 * would squash its circle into an ellipse, which is the whole thing being
 * matched. So the construction is reproduced instead, at the radius measured
 * off that asset: vertical to the turn, a true quarter arc of r 19.25, then
 * whatever flat run is left to reach the avatar.
 *
 * The frame's own connector corners at about r 8 over a long flat run, which
 * reads as an L rather than a curve. That is the older style.
 */
const RAIL_W = 24.5;
const RAIL_R = 19.25;
/** Where a spur's foot lands inside its own row: the avatar's centre line,
    which is the row's 1px top padding plus half of 28. */
const RAIL_FOOT = 15;
/** Spur heights, measured off the laid-out thread. The first starts behind
    Jacob's avatar, 43 above the reply it feeds.

    The rest have to reach the VERTICAL of the spur above, not its box: a
    spur's line turns away 19.25 early, so the last 19.25 of its height is
    arc, not spine. Against the widest avatar gap of 80.9 that means 100.1 at
    minimum, and 108 leaves margin. 92 looked continuous by bounding box and
    left an 8.1 gap of bare gutter on screen. Anything extra is drawn over
    empty gutter or clipped by the body. */
const RAIL_H_FIRST = 43;
const RAIL_H_REST = 108;
const railPath = (h: number) =>
  `M0.25 0.25V${(h - 0.25 - RAIL_R).toFixed(2)}` +
  `A${RAIL_R} ${RAIL_R} 0 0 0 ${(0.25 + RAIL_R).toFixed(2)} ${(h - 0.25).toFixed(2)}` +
  `H${(RAIL_W - 0.25).toFixed(2)}`;

const BULLETS = [
  'Julia mentioned you to confirm embargo time.',
  'PostHog flag are returning false. Rahul is on it.',
  'Gabriel filed',
];

const MENU = [
  { icon: IconMenuChat, label: 'Open in Chat', gap: 5 },
  { icon: IconMenuAutomation, label: 'Automation', gap: 5 },
  { icon: IconMenuSkill, label: 'Add Skill', gap: 7 },
];
/** The row the scene ends on. The frame highlights Automation instead, but
    the story here is the interaction becoming a skill. */
const SKILL_ROW = 2;

export function AgentThreadGraphic() {
  const [t, setT] = createSignal(TL.cycle - 2000);
  const [frameW, setFrameW] = createSignal(STAGE_W);
  let figEl: HTMLDivElement | undefined;

  const visible = createVisible(() => figEl, '120px');
  const prog = (a: number, b: number) => clamp01((t() - a) / (b - a));

  onMount(() => {
    if (figEl && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(([e]) =>
        setFrameW(e.contentRect.width || STAGE_W)
      );
      ro.observe(figEl);
      onCleanup(() => ro.disconnect());
    }
    const reduce =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // The finished frame, which is the one that carries the whole claim.
    if (reduce) {
      setT(TL.lit + 400);
      return;
    }
    let last = performance.now();
    let clock = 0;
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      if (visible()) {
        clock = (clock + dt) % TL.cycle;
        setT(clock);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const scale = () => frameW() / STAGE_W;
  /** Everything fades together at the end of the cycle, so the loop restarts
      from an empty thread rather than cutting. */
  const out = () => ease(prog(TL.outStart, TL.outEnd));
  const live = (v: number) => v * (1 - out());

  const askIn = () => live(ease(prog(TL.askIn, TL.askEnd)));
  const mentionLit = () => live(ease(prog(TL.mentionLit, TL.mentionLit + 260)));
  const elbowDraw = () => ease(prog(TL.elbowIn, TL.elbowEnd));
  const agentIn = () => live(ease(prog(TL.agentIn, TL.agentIn + 380)));
  /** Before workEnd the agent is still going, which the label and a pulsing
      dot both say; after it, the count replaces them. */
  const working = () => t() >= TL.agentIn && t() < TL.workEnd;
  const leadIn = () => live(ease(prog(TL.lead, TL.lead + 300)));
  const bulletIn = (i: number) =>
    live(
      ease(
        prog(TL.bullet + i * TL.bulletStep, TL.bullet + i * TL.bulletStep + 320)
      )
    );
  const chipIn = () => live(ease(prog(TL.chip, TL.chip + 340)));
  const ask2In = () => live(ease(prog(TL.ask2In, TL.ask2In + 380)));
  const agent2In = () => live(ease(prog(TL.agent2In, TL.agent2In + 340)));
  const working2 = () => t() >= TL.agent2In && t() < TL.work2End;
  const reply2In = () => live(ease(prog(TL.reply2, TL.reply2 + 300)));
  const menuIn = () => live(easeInOut(prog(TL.menuIn, TL.menuEnd)));
  const hoverIn = () => live(ease(prog(TL.hover, TL.hover + 220)));
  const litIn = () => live(ease(prog(TL.lit, TL.lit + 260)));

  /** One spur of the thread rail, drawn as its own message arrives. */
  const Rail = (p: { h: number; draw: number }) => (
    <svg
      class="atg-rail"
      viewBox={`0 0 ${RAIL_W} ${p.h}`}
      fill="none"
      aria-hidden="true"
      style={{ height: `${p.h}px`, top: `${RAIL_FOOT - p.h}px` }}
    >
      <path
        d={railPath(p.h)}
        stroke="#353535"
        stroke-width="0.5"
        stroke-linecap="round"
        pathLength="100"
        stroke-dasharray="100"
        stroke-dashoffset={100 * (1 - p.draw)}
      />
    </svg>
  );

  const Ic = (p: {
    icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    size: number;
    opacity?: number;
  }) => (
    <Dynamic
      component={p.icon}
      style={{
        display: 'block',
        height: `${p.size}px`,
        opacity: p.opacity,
        width: `${p.size}px`,
      }}
    />
  );

  /** A row that rises a little as it fades in — the amount is in stage units,
      so it scales with everything else. */
  const enter = (amt: number, rise = 4): JSX.CSSProperties => ({
    opacity: amt,
    translate: `0 ${((1 - amt) * rise).toFixed(2)}px`,
  });

  return (
    <div ref={figEl} class="atg-fig">
      <style>{`
        .atg-fig { position: relative; width: 100%; }
        .atg, .atg * { box-sizing: border-box; }
        /* In flow, not absolute, so the board's height follows the thread and
           the figure's follows the board through the zoom. Adding a message
           costs nothing but the message. */
        .atg {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          color: #fff;
          font-family: ${appFont};
          padding-bottom: ${MENU_DROP}px;
          position: relative;
          width: ${STAGE_W}px;
        }
        /* The window is 459 of the 523 board; the rest is the room the menu
           hangs into at the lower right. */
        .atg-window {
          background: #060709;
          border: 0.5px solid transparent;
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          margin: 0.5px;
          overflow: hidden;
          position: relative;
          width: 459px;
        }
        /* Lit from the top and a little left, the same masked padding-box rim
           the preview graphic uses, dimmer: this board is 523 units against
           that one's 918, so it is zoomed UP rather than down and the same
           stops read brighter and heavier over a smaller picture. The
           thickness is set inline for the same reason -- zoom scales px, so a
           flat 1px here lands near 2.1 device px on a desktop column. The
           border above is transparent and only reserves the pixel, so the box
           metrics do not move. */
        .atg-rim {
          /* 172deg rather than 160: the gradient line is now within 8 degrees
             of vertical, so the light sits on the top edge with only a hint of
             left bias instead of running a long way down the left side. The
             top edge spans the first ~14% of that line on a box this wide,
             which is why the bright pair of stops is held out to 14% and the
             falloff is steep after it -- the sides are dim within about 50px
             of the corner. */
          background: linear-gradient(
            172deg,
            rgb(232 232 232 / 0.4) 0%,
            rgb(232 232 232 / 0.3) 14%,
            rgb(232 232 232 / 0.13) 30%,
            rgb(232 232 232 / 0.07) 55%,
            rgb(232 232 232 / 0.055) 100%
          );
          border-radius: inherit;
          inset: 0;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
          position: absolute;
          z-index: 6;
        }
        .atg-head {
          align-items: center;
          border-bottom: 0.5px solid #353535;
          display: flex;
          flex-shrink: 0;
          justify-content: space-between;
          padding: 8px 8px 8px 16px;
          width: 100%;
        }
        .atg-title { font-size: 10px; font-weight: 600; white-space: nowrap; }
        .atg-tabs {
          align-items: flex-start;
          background: #000;
          border: 0.5px solid #1f1f1f;
          border-radius: 7px;
          display: flex;
          gap: 4px;
          padding: 2.5px;
        }
        .atg-tab {
          align-items: center;
          border-radius: 5px;
          color: #8b8b8b;
          display: flex;
          font-size: 10px;
          font-weight: 500;
          gap: 4px;
          padding: 3px 6px 4px;
          white-space: nowrap;
        }
        .atg-tab-on { background: #16191f; border: 0.5px solid #353535; color: #fff; }
        .atg-calldot { background: #6ac370; border-radius: 999px; height: 4px; width: 4px; }
        .atg-faces { align-items: center; display: flex; }
        .atg-faces > * { margin-right: -2px; }
        .atg-faces > :last-child { margin-right: 0; }
        .atg-plus {
          align-items: center;
          color: #bfbfbf;
          display: flex;
          font-size: 8px;
          font-weight: 500;
          height: 19px;
          padding: 0 3px;
          width: 24px;
        }
        .atg-face { border-radius: 999px; flex-shrink: 0; object-fit: cover; }
        .atg-face-ring { border: 1px solid #16191f; }
        .atg-callbtn {
          align-items: center;
          background: #16191f;
          border: 0.5px solid #353535;
          border-radius: 7px;
          display: flex;
          flex-shrink: 0;
          height: 24px;
          justify-content: center;
          width: 24px;
        }
        /* Body */
        .atg-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow: hidden;
          /* Deeper at the foot than the head: the last message is the one the
             menu opens over, and it sat almost on the frame edge. */
          padding: 16px 8px 28px;
          position: relative;
          width: 100%;
        }
        /* A spur per threaded row. left puts the spine on Jacob's avatar
           centre line, and top hangs the box so its foot lands on this row's
           own avatar centre. */
        .atg-rail {
          left: -12.25px;
          pointer-events: none;
          position: absolute;
          width: ${RAIL_W}px;
          z-index: 0;
        }
        /* Every avatar sits above the rail, so the spine passes behind them.
           DOM order is not enough on its own: the rail is absolutely
           positioned and paints over in-flow content whatever the order,
           which is what put it across Jacob's face. */
        .atg-face, .atg-agentface { position: relative; z-index: 1; }
        /* And that z-index alone is not enough either, because every row
           carries an entry translate, and a translate that is not none makes
           the row a stacking context -- which traps the avatar's z-index
           inside its own row. So the ordering has to be between the rows:
           the rails hang UPWARD out of the agent rows, so each row paints
           below the ones before it. A row added later goes below these. */
        .atg-msg { z-index: 3; }
        .atg-agentwrap { z-index: 2; }
        .atg-msg { display: flex; gap: 10px; padding: 1px 6px; width: 100%; }
        .atg-msgbody { display: flex; flex: 1 0 0; flex-direction: column; gap: 3px; min-width: 0; }
        .atg-msghead {
          display: flex;
          font-size: 10px;
          justify-content: space-between;
          padding-bottom: 2px;
          white-space: nowrap;
          width: 100%;
        }
        .atg-who { font-weight: 600; }
        .atg-time, .atg-meta { color: #8b8b8b; font-weight: 400; }
        .atg-text { color: #fff; font-size: 10px; margin: 0; position: relative; }
        /* The @mention chip: a highlight behind the word rather than a pill
           around it, which is how the frame draws it. */
        .atg-mention { color: #ff8f00; font-weight: 500; position: relative; z-index: 1; }
        .atg-mention-bg {
          background: rgb(255 143 0 / 0.2);
          border-radius: 2px;
          height: 12px;
          left: -1.5px;
          position: absolute;
          top: 0.5px;
          width: 42px;
        }
        .atg-agentwrap { display: flex; flex-direction: column; gap: 8px; padding-left: 32px; width: 100%; }
        .atg-agentrow { display: flex; gap: 10px; padding: 1px 6px 1px 10px; position: relative; width: 100%; }
        .atg-agentface {
          align-items: center;
          background: #000;
          border: 0.5px solid #353535;
          border-radius: 999px;
          display: flex;
          flex-shrink: 0;
          height: 28px;
          justify-content: center;
          width: 28px;
        }
        .atg-agentbody { display: flex; flex: 1 0 0; flex-direction: column; gap: 4px; min-width: 0; }
        .atg-answer { color: #fff; font-size: 10px; margin: 0; padding-right: 64px; }
        .atg-lead { line-height: 13px; margin: 0; }
        .atg-list { list-style: disc; margin: 0; padding: 0; }
        .atg-list li { line-height: 13px; margin-left: 15px; }
        /* The working dot, which is the only thing in the scene that is not a
           function of the clock alone -- it breathes on its own so the agent
           reads as busy rather than stalled. */
        .atg-pulse {
          animation: atg-pulse 1.05s ease-in-out infinite;
          background: #ff8f00;
          border-radius: 999px;
          height: 4px;
          /* Parked on the bullet it turns into once the agent is done. The
             flex row centres this dot on the line box, but the glyph's ink
             sits below that centre -- measured at 0.71 units down and 0.38
             left of it for the bullet in Inter at this size -- so without the
             nudge the dot jumps when the text swaps. Relative, so the words
             after it do not move. */
          left: -0.38px;
          position: relative;
          top: 0.71px;
          width: 4px;
        }
        @keyframes atg-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
        /* The inline task, same construction as the preview graphic's. */
        .atg-task { align-items: center; display: flex; gap: 2px; }
        .atg-tasktitle {
          text-decoration: underline;
          text-decoration-skip-ink: auto;
          text-decoration-thickness: 0.5px;
          text-underline-offset: 1px;
        }
        .atg-taskstatus { align-items: center; display: flex; height: 12px; justify-content: center; width: 12px; }
        /* Menu */
        .atg-menu {
          background: #16191f;
          border: 0.5px solid #353535;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          bottom: 0;
          overflow: hidden;
          padding: 4px 3px;
          position: absolute;
          right: 0;
          transform-origin: 10% 0%;
          width: 120px;
          /* Above .atg-rim, not below it. The window is not a stacking context
             -- position: relative with no z-index -- so its rim competes with
             the menu in .atg's context, and at 6 it drew the frame's lit edge
             straight across the popup, which reads as the popup being
             see-through. */
          z-index: 7;
        }
        .atg-menurow {
          align-items: center;
          border-radius: 6px;
          color: #bfbfbf;
          display: flex;
          font-size: 10px;
          padding: 1px 5px;
          position: relative;
          width: 100%;
        }
        .atg-menulabel { white-space: nowrap; }
        /* The chosen row, in plain light rather than an accent hue: a menu
           selection is chrome, and tinting it competed with the two things in
           the scene that are genuinely orange -- the @Macro mention and the
           task chip. */
        .atg-menurow-fill {
          background: rgb(255 255 255 / 0.1);
          border-radius: 6px;
          inset: 0;
          position: absolute;
        }
      `}</style>

      <div class="atg" style={{ zoom: scale() }}>
        <div class="atg-window">
          <div class="atg-head">
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '16px' }}
            >
              <div
                style={{
                  'align-items': 'flex-end',
                  display: 'flex',
                  gap: '4px',
                }}
              >
                <Ic icon={IconHash} size={11} />
                <span class="atg-title">bug reports</span>
              </div>
              <div class="atg-tabs">
                <span class="atg-tab atg-tab-on">Selected</span>
                <span class="atg-tab">Attachments</span>
                <span class="atg-tab">
                  <span class="atg-calldot" />
                  Call
                </span>
              </div>
            </div>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '16px' }}
            >
              <div class="atg-faces">
                <span class="atg-plus">+16</span>
                <img
                  src={avatarTeo}
                  alt=""
                  class="atg-face atg-face-ring"
                  style={{ height: '18px', width: '18px' }}
                />
                <img
                  src={avatarGabriel}
                  alt=""
                  class="atg-face atg-face-ring"
                  style={{ height: '18px', width: '18px' }}
                />
                <img
                  src={avatarJacob}
                  alt=""
                  class="atg-face"
                  style={{ height: '18px', width: '18px' }}
                />
              </div>
              <div class="atg-callbtn">
                <Ic icon={IconCall} size={12} />
              </div>
            </div>
          </div>

          <div class="atg-body">
            {/* Draws down from Jacob's avatar into the agent's. */}
            <div class="atg-msg" style={enter(askIn())}>
              <img
                src={avatarJacob}
                alt=""
                class="atg-face"
                style={{ height: '28px', width: '28px' }}
              />
              <div class="atg-msgbody">
                <div class="atg-msghead">
                  <span class="atg-who">Jacob</span>
                  <span class="atg-time">8:02 AM</span>
                </div>
                <p class="atg-text">
                  <span
                    class="atg-mention-bg"
                    style={{
                      opacity: mentionLit(),
                      scale: `${(0.7 + 0.3 * mentionLit()).toFixed(3)} 1`,
                    }}
                  />
                  <span class="atg-mention">@Macro</span> I&rsquo;ve been out
                  since Thursday, catch me up
                </p>
              </div>
            </div>

            <div class="atg-agentwrap" style={enter(agentIn())}>
              <div class="atg-agentrow">
                <Rail h={RAIL_H_FIRST} draw={elbowDraw() * (1 - out())} />
                <div class="atg-agentface">
                  <MacroMarkIcon
                    style={{ color: '#ff8f00', height: '14px', width: '14px' }}
                  />
                </div>
                <div class="atg-agentbody">
                  <div class="atg-msghead">
                    <span
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '3px',
                      }}
                    >
                      <span class="atg-who">Macro</span>
                      <Show
                        when={!working()}
                        fallback={
                          <span
                            class="atg-meta"
                            style={{
                              'align-items': 'center',
                              display: 'flex',
                              gap: '4px',
                            }}
                          >
                            Agent
                            <span class="atg-pulse" />
                            summarizing&hellip;
                          </span>
                        }
                      >
                        <span class="atg-meta">
                          Agent &bull; summarized 16 messages
                        </span>
                      </Show>
                    </span>
                    <span class="atg-time">8:03 AM</span>
                  </div>
                  <div class="atg-answer">
                    <p class="atg-lead" style={enter(leadIn(), 3)}>
                      Three things to know:
                    </p>
                    <ul class="atg-list">
                      <For each={BULLETS}>
                        {(b, i) => (
                          <li style={enter(bulletIn(i()), 3)}>
                            {b}
                            <Show when={i() === BULLETS.length - 1}>
                              {' '}
                              <span
                                class="atg-task"
                                style={{
                                  display: 'inline-flex',
                                  opacity: chipIn(),
                                  'vertical-align': 'middle',
                                }}
                              >
                                <Ic icon={IconTaskGlyph} size={12} />
                                <span class="atg-tasktitle">
                                  Fix pricing step drop-off
                                </span>
                                <span class="atg-taskstatus">
                                  <Ic icon={IconTaskStatus} size={8} />
                                </span>
                                <Ic icon={IconTaskPriority} size={10} />
                                <img
                                  src={avatarGabriel}
                                  alt=""
                                  class="atg-face"
                                  style={{ height: '10px', width: '10px' }}
                                />
                              </span>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Jacob hands the task back. Sits at the thread's indent
                  rather than the channel's, so it reads as the same
                  conversation continuing. */}
              <div class="atg-agentrow" style={enter(ask2In())}>
                <Rail h={RAIL_H_REST} draw={ask2In()} />
                <img
                  src={avatarJacob}
                  alt=""
                  class="atg-face"
                  style={{ height: '28px', width: '28px' }}
                />
                <div class="atg-agentbody">
                  <div class="atg-msghead">
                    <span class="atg-who">Jacob</span>
                    <span class="atg-time">8:05 AM</span>
                  </div>
                  <p class="atg-text">
                    Can you take that last one and push a preliminary fix?
                  </p>
                </div>
              </div>

              {/* And takes it. */}
              <div class="atg-agentrow" style={enter(agent2In())}>
                <Rail h={RAIL_H_REST} draw={agent2In()} />
                <div class="atg-agentface">
                  <MacroMarkIcon
                    style={{ color: '#ff8f00', height: '14px', width: '14px' }}
                  />
                </div>
                <div class="atg-agentbody">
                  <div class="atg-msghead">
                    <span
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '3px',
                      }}
                    >
                      <span class="atg-who">Macro</span>
                      <Show
                        when={!working2()}
                        fallback={
                          <span
                            class="atg-meta"
                            style={{
                              'align-items': 'center',
                              display: 'flex',
                              gap: '4px',
                            }}
                          >
                            Agent
                            <span class="atg-pulse" />
                            working&hellip;
                          </span>
                        }
                      >
                        <span class="atg-meta">
                          Agent &bull; assigned to itself
                        </span>
                      </Show>
                    </span>
                    <span class="atg-time">8:05 AM</span>
                  </div>
                  <p class="atg-text" style={enter(reply2In(), 3)}>
                    On it. I&rsquo;ll push a branch and tag you on the PR.
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* 0.75 CSS px however the board is zoomed: 1.5 device px at the
              bright end on a 2x screen, which is thin without going crunchy. */}
          <span
            aria-hidden="true"
            class="atg-rim"
            style={{ padding: `${(0.75 / scale()).toFixed(3)}px` }}
          />
        </div>

        {/* The menu. It scales up from its own top-left, which is where a
            click would have landed. */}
        <div
          class="atg-menu"
          style={{
            opacity: menuIn(),
            scale: `${(0.94 + 0.06 * menuIn()).toFixed(3)}`,
          }}
        >
          <For each={MENU}>
            {(row, i) => {
              const chosen = () => (i() === SKILL_ROW ? litIn() : 0);
              const hovered = () =>
                i() === SKILL_ROW ? Math.max(hoverIn() * 0.45, chosen()) : 0;
              return (
                <div class="atg-menurow" style={{ gap: `${row.gap}px` }}>
                  <span
                    class="atg-menurow-fill"
                    style={{ opacity: hovered() }}
                  />
                  <span
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      height: '16px',
                      position: 'relative',
                      width: '16px',
                    }}
                  >
                    <Ic icon={row.icon} size={i() === SKILL_ROW ? 14 : 16} />
                  </span>
                  <span
                    class="atg-menulabel"
                    style={{
                      color: `color-mix(in srgb, #fff ${(chosen() * 100).toFixed(0)}%, #bfbfbf)`,
                      position: 'relative',
                    }}
                  >
                    {row.label}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
