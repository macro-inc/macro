import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconChannel from '../../../assets/icons/icon-channels.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconReply from '../../../assets/icons/phosphor/arrow-bend-up-left.svg';
import IconArrowUp from '../../../assets/icons/phosphor/arrow-up.svg';
import IconArrowsOut from '../../../assets/icons/phosphor/arrows-out.svg';
import IconCalendar from '../../../assets/icons/phosphor/calendar-blank.svg';
import IconCaretDown from '../../../assets/icons/phosphor/caret-down.svg';
import IconCheck from '../../../assets/icons/phosphor/check.svg';
import IconDots from '../../../assets/icons/phosphor/dots-three-vertical.svg';
import IconGitBranch from '../../../assets/icons/phosphor/git-branch.svg';
import IconPullRequest from '../../../assets/icons/phosphor/git-pull-request.svg';
import IconLink from '../../../assets/icons/phosphor/link.svg';
import IconPaperclip from '../../../assets/icons/phosphor/paperclip.svg';
import IconPhone from '../../../assets/icons/phosphor/phone.svg';
import IconShare from '../../../assets/icons/phosphor/share.svg';
import IconSmiley from '../../../assets/icons/phosphor/smiley.svg';
import IconTextAa from '../../../assets/icons/phosphor/text-aa.svg';
import StatusCreated from '../../../assets/icons/square-task-created-circle.svg';
import StatusDone from '../../../assets/icons/square-task-done-circle.svg';
import StatusInProgress from '../../../assets/icons/square-task-in-progress-circle.svg';
import PriorityHigh from '../../../assets/icons/wide-priority-high.svg';
import IconTask from '../../../assets/icons/wide-task.svg';
import avatarAidan from '../../../assets/people/aidan.webp';
import avatarTeo from '../../../assets/people/teo.webp';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

// ---------------------------------------------------------------------------
// The lifecycle scene — one task, from a sentence typed into #bug reports to
// the agent reporting it closed, as a single continuous HTML scene.
//
// Everything on screen is a pure function of the clock `t` (ms into CYCLE)
// that TasksLifecycle owns: there are no timers, tweens or transitions of
// state in here, only `prog(a, b)` ramps read off `t`. That is what lets the
// section seek (a step click sets `t`), hold (it stops advancing `t`) and
// paint a sensible SSR frame (a fixed `t`) without any of this knowing.
// The mechanism is ChannelCohesionGraphic's (ChannelsGraphics.tsx:1170).
//
// Geometry. The scene is laid out at a fixed 880x402 CSS px -- the artboard
// the frame, its gradient and the section's spacing were built around -- and
// the root is `zoom`ed to the frame's actual width. Inside it each panel sits
// in a second `zoom` of 440/386, so every number below is the Figma frame's
// number verbatim (file IOH8EtjS7V8rmxnbJzFZ2A, nodes 891:14734, 899:15067,
// 906:15311, 914:15594) and the panels land at exactly the scale the SVG
// exports had. `zoom` rather than transform because it reflows: text is laid
// out at its final size and stays crisp.
// ---------------------------------------------------------------------------

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const STAGE_W = 880;
export const STAGE_H = 402;
/** Side inset shared with the previous artboards, so the frame's breathing
    room is unchanged. */
const SIDE = 62;
/** Every panel export is drawn at 386 wide and shown at 440 stage units. */
const PANEL_ZOOM = 440 / 386;
const CHANNEL_W = 440;
/** How far left of its SIDE-anchored home the channel sits while it is the
    only thing on the stage. Derived rather than typed so it follows if the
    stage or the inset ever moves. */
const CENTER_SHIFT = STAGE_W - SIDE - CHANNEL_W - (STAGE_W - CHANNEL_W) / 2;

// --- the phone camera --------------------------------------------------------
// The artboard is sized for the widest thing that ever stands on it -- the task
// panel at 684 units, and phase 4's card and channel side by side at 756. Every
// other phase then sits in the middle of all that room, which on a desktop
// frame reads as composition and on a 315px one reads as a postage stamp: the
// channel is 440 of 880 units, so half the frame is empty margin.
//
// So on a phone the scene is not scaled to the artboard, it is scaled to a
// WINDOW onto the artboard, and the window is a function of t like everything
// else here. Nothing in the layout moves; only what the frame is looking at.
// Three framings, lerped across the two swaps that are already covering for
// them -- the channel is receding and the panel arriving, which is exactly
// when a camera move is invisible.
const phone = () => viewportWidth() < 700;
/** Fixed, because the stage box's aspect cannot change with t without the
    section's height changing under the reader. A compromise between the tall
    channel and the wide task panel; each framing places its own y to suit. */
export const MOBILE_ASPECT = 1.5;
type View = { w: number; x: number; y: number };
const VIEWS: Record<'a' | 'b' | 'c', View> = {
  /** Phases 1-2: the centred channel, with 20 units of air either side and the
      composer sitting just above the bottom edge. */
  a: { w: 480, x: 200, y: 40 },
  /** Phase 3: the task panel alone -- 684 units wide at x 98, so this is that
      box plus 16 either side. Narrower than phase 4's framing because the
      panel is the only thing on the stage. */
  b: { w: 716, x: 82, y: 38 },
  /** Phase 4: same width -- the card and the channel are side by side -- but
      raised, so the space under the channel goes to the thread above it
      instead of to nothing. */
  c: { w: 800, x: 40, y: -110 },
};
const DESKTOP_VIEW: View = { w: STAGE_W, x: 0, y: 0 };

// --- the timeline, in ms -----------------------------------------------------
// Beats are named rather than derived so the whole story reads top to bottom.
// Pairs are [start, end] of a ramp; single numbers are instants.
export const TL = {
  caretIn: 600,
  type: [800, 3900] as const,
  toToggle: [3980, 4720] as const,
  toggleClick: 4800,
  /** Toggle, border and send tint flip. */
  flip: [4800, 5100] as const,
  /** The prose lifts out while the composer grows to its task-mode height. */
  proseOut: [5100, 5480] as const,
  grow: [5100, 5900] as const,
  taskIn: [5320, 5800] as const,
  chipsIn: [5600, 6000] as const,
  toAssignee: [6350, 7060] as const,
  assigneeClick: 7180,
  /** Arrow-up walks the open menu; teoPick is the Enter that takes the row. */
  teoPick: 8000,
  toDue: [8160, 8820] as const,
  dueClick: 8940,
  tomorrowPick: 9760,
  toSend: [10040, 10760] as const,
  sendClick: 10880,
  /** The task message rises into the thread; the composer falls back to a
      one-line message box. */
  post: [10880, 11380] as const,
  reset: [10880, 11230] as const,
  /** How stage 2 hands over to stage 3: the pointer goes back to the task it
      just sent, hovering raises the message's action bar, and opening the task
      full screen is what brings the detail panel forward. Before this the
      panel simply swapped in on a timer, with nobody asking for it. */
  toTaskMsg: [11960, 12620] as const,
  /** Overlaps the end of the travel above, which is not a mistake: a real
      hover fires the moment the pointer crosses the link, and the throw puts
      it there at about 60% of the segment -- everything after that is the
      corrective hops landing it on the mark. Waiting for the segment to end
      made the bar read as a response to a click rather than to the hover. */
  taskMenu: [12400, 12660] as const,
  /** Starts 60ms after the pointer reaches the link, not half a second
      after: the menu is already open by the time the hand gets there, so
      the two moves are one gesture down and left, not a stop and a
      restart. */
  toExpand: [12680, 13240] as const,
  expandClick: 13360,
  /** Channel recedes, task panel comes forward. */
  swap: [13480, 14380] as const,
  row2: 15080,
  tick1: 15980,
  tick2: 16680,
  row3: 17480,
  swapBack: [20480, 21380] as const,
  agentMsg: [21680, 22080] as const,
  toMention: [22680, 23680] as const,
  hover: 23830,
  /** The channel gives up the centre; the card takes the left half. */
  cardShift: [23880, 24580] as const,
  cardIn: [24030, 24530] as const,
  fadeOut: [27280, 27780] as const,
};
export const CYCLE = 27880;

export type Phase = {
  id: string;
  title: string;
  blurb: string;
  start: number;
  rest: number;
};

/** `rest` is the frame that stands for the phase: what reduced motion shows,
    what a manual step click plays up to and holds on, and (for the first)
    what the server renders. */
export const PHASES: Phase[] = [
  {
    id: 'describe',
    title: 'Invite issue',
    blurb: '“Two teammates lost their team when they opened the invite link.”',
    start: 0,
    rest: 4700,
  },
  {
    id: 'fill',
    title: 'Assigned to Teo',
    blurb: '“Make this a task. We need it fixed before Thursday.”',
    start: TL.toggleClick,
    rest: 11900,
  },
  {
    id: 'update',
    title: 'Fix in progress',
    blurb: '“Found the redirect. The patch is ready for review.”',
    start: TL.swap[0],
    rest: 19280,
  },
  {
    id: 'report',
    title: 'Ready for Thursday',
    blurb: '“Merged and checked. Invited teammates keep their team.”',
    start: TL.swapBack[0],
    rest: 25980,
  },
];

// --- copy --------------------------------------------------------------------
const CHANNEL = 'launch';
const ISSUE =
  'The invite flow is dropping people. Two teammates lost their team when they opened the invite link.';
const TASK_TITLE = 'Fix the team invite handoff';
const PR_TITLE = 'fix(invites): preserve team through onboarding';

// Typing schedule: one timestamp per character, so `typed` is a plain count of
// how many are <= t. A flat cadence reads as a machine; a little deterministic
// jitter plus a beat after the full stop reads as a person, and being a table
// it costs the same to seek into as to play through.
const CHAR_AT: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < ISSUE.length; i++) {
    const ch = ISSUE[i];
    let d = 26 + (((i * 7919) % 11) - 5) * 1.6;
    if (ch === ' ') d += 28;
    if (i > 0 && ISSUE[i - 1] === '.') d += 170;
    acc += d;
    out.push(acc);
  }
  const [a, b] = TL.type;
  return out.map((v) => a + (v / acc) * (b - a));
})();

// --- maths -------------------------------------------------------------------
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Takes a child out of flow at the top of the composer's content box, so it
    can be swapped for another without the box reflowing around it. */
const PIN = { left: 0, position: 'absolute', right: 0, top: 0 } as const;
const ease = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// --- primitives --------------------------------------------------------------

/** `overflow: visible` is not decoration -- these icons are drawn to the very
    edge of their viewBox (the status rings are circles touching all four
    sides), and an svg root clips to its viewport by default. At the fractional
    sizes the stage's zoom chain produces, the bottom edge lands mid-pixel and
    the clip shaves the anti-aliased row, which reads as a circle with a flat
    bottom. The repo sets it on every inlined icon for the same reason -- see
    navIconStyle in featureGraphics/TasksGraphics.tsx. */
const Ic = (p: {
  icon: Component<any>;
  w: number;
  h?: number;
  color?: string;
  style?: JSX.CSSProperties;
}) => (
  <Dynamic
    component={p.icon}
    aria-hidden="true"
    style={{
      color: p.color,
      display: 'block',
      flex: 'none',
      height: `${p.h ?? p.w}px`,
      overflow: 'visible',
      width: `${p.w}px`,
      ...p.style,
    }}
  />
);

const Avatar = (p: { src: string; size: number; ring?: string }) => (
  <img
    alt=""
    src={p.src}
    width={p.size}
    height={p.size}
    class="tls-avatar"
    style={{
      border: p.ring ? `0.5px solid ${p.ring}` : undefined,
      height: `${p.size}px`,
      width: `${p.size}px`,
    }}
  />
);

/** The task's status, priority and owner as bare glyphs, trailing a task
    mention. At this size a labelled pill was three quarters width and said
    what the glyph already says, so the labels are dropped. Status is the only
    one that moves -- the task is Created when it is sent into the channel and
    Completed by the time the agent reports back -- so it is the parameter. */
const TaskMeta = (p: { status: { icon: Component<any>; color: string } }) => (
  <span class="tls-taskmeta">
    <Ic icon={p.status.icon} w={10} color={p.status.color} />
    <Ic icon={PriorityHigh} w={10} h={7} color="#bfbfbf" />
    <Avatar src={avatarTeo} size={10} ring="#16191f" />
  </span>
);

/** Stands in for an avatar on the rows an agent wrote. Every other activity
    row leads with a 10px face, and the connector line down the left of the
    list is positioned against that, so this matches the footprint exactly and
    fills it with the surface-and-hairline the scene's chips already use. The
    glyph is orange because that is @Macro's colour everywhere else in the row.
    The Phosphor mark carries its own padding inside a 256 viewBox -- it fills
    about two thirds of it -- so the icon is set larger than the disc's inner
    box to land at a sensible optical size. */
const ActivityDisc = (p: { icon: Component<any>; size?: number }) => {
  const s = p.size ?? 10;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        background: '#16191f',
        border: '0.5px solid #353535',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        display: 'inline-flex',
        flex: 'none',
        height: `${s}px`,
        'justify-content': 'center',
        width: `${s}px`,
      }}
    >
      <Ic icon={p.icon} w={s * 0.86} color="#ff8f00" />
    </span>
  );
};

/** Macro's face wherever it appears as a participant: the brand mark in
    orange on a black disc. The mark's viewBox is 182x119, so it is sized by
    width with its height following that ratio -- forcing it square would
    squash the three strokes. The hairline ring is the one the thread's reply
    avatars carry; without it a black disc on a near-black panel has no edge. */
const AgentDisc = (p: { size: number }) => (
  <span
    aria-hidden="true"
    style={{
      'align-items': 'center',
      background: '#000',
      border: '0.5px solid #353535',
      'border-radius': '999px',
      'box-sizing': 'border-box',
      display: 'inline-flex',
      flex: 'none',
      height: `${p.size}px`,
      'justify-content': 'center',
      width: `${p.size}px`,
    }}
  >
    <MacroMarkIcon
      style={{
        color: 'var(--a0)',
        display: 'block',
        fill: 'currentColor',
        flex: 'none',
        height: `${((p.size * 0.58) / (182 / 119)).toFixed(2)}px`,
        overflow: 'visible',
        width: `${(p.size * 0.58).toFixed(2)}px`,
      }}
    />
  </span>
);

/** The product's own pointer, lifted verbatim from the cursor drawn in
    tasks-chat-integration.svg -- a tilted arrow with all three corners rounded,
    not the hard-edged dart the older mocks on the site draw by hand. The source
    path carries a fill and no stroke, which is why there is none here.
    Normalised so its 9.014 x 9.012 bounding box starts at the origin. */
const CURSOR_VB = { w: 9.014, h: 9.012 };
const CURSOR_PATH =
  'M3.902 8.546L5.012 5.511L5.512 5.011L8.547 3.902L8.562 3.896C8.7 3.834 8.817 3.733 8.896 3.604C8.976 3.475 9.014 3.326 9.007 3.175C9 3.024 8.947 2.878 8.856 2.758C8.765 2.637 8.639 2.547 8.496 2.499L0.992 0.049C0.861 0.006 0.72 0 0.586 0.032C0.452 0.064 0.329 0.133 0.231 0.231C0.133 0.328 0.065 0.451 0.032 0.585C0 0.72 0.006 0.86 0.049 0.992L2.499 8.496C2.545 8.64 2.635 8.768 2.756 8.86C2.877 8.952 3.023 9.005 3.175 9.011H3.211C3.357 9.012 3.5 8.969 3.621 8.889C3.743 8.809 3.839 8.695 3.896 8.562L3.902 8.546Z';
/** Where the point actually lands, as a fraction of that box. Not (0, 0): the
    tip is a rounded corner whose curve turns at (0.231, 0.231), and offsetting
    by the box instead would hang the cursor a third of a pixel off its target
    at every scale. The same on both axes -- the corner is a 45-degree turn. */
const CURSOR_TIP = 0.231 / CURSOR_VB.w;
const Pointer = (p: { size: number }) => (
  <svg
    width={p.size}
    height={p.size}
    viewBox={`0 0 ${CURSOR_VB.w} ${CURSOR_VB.h}`}
    aria-hidden="true"
    style={{ display: 'block', overflow: 'visible' }}
  >
    <path d={CURSOR_PATH} fill="#fff" />
  </svg>
);

/** Channel-style inline mention: a small icon, then underlined text. */
const Mention = (p: {
  icon: Component<any>;
  w: number;
  color?: string;
  children: JSX.Element;
  ref?: (el: HTMLSpanElement) => void;
  hot?: boolean;
  target?: string;
}) => (
  <span
    ref={p.ref}
    data-tlc-target={p.target}
    class="tls-mention"
    style={{
      background: p.hot ? 'rgba(255,255,255,0.09)' : 'transparent',
      'text-decoration-color': p.hot ? '#fff' : 'rgba(255,255,255,0.55)',
    }}
  >
    {/* No colour means the surrounding ink. Every mention that wants an accent
        asks for one; the default is not periwinkle, so a hash dropped into a
        sentence reads as part of it. */}
    <Ic
      icon={p.icon}
      w={p.w}
      color={p.color}
      style={{
        display: 'inline-block',
        'vertical-align': '-1px',
        'margin-right': '3px',
      }}
    />
    <span class="tls-u">{p.children}</span>
  </span>
);

/** Blur that ramps up the thread instead of switching on at an edge, so the
    context above the composer falls out of focus gradually. Four bands whose
    radii roughly double and whose masks fade in a little higher each, the
    same construction the SVG stages used. Radii are in the panel's own px:
    this lives inside the panel's zoom, so they scale with it for free.
    A third of the SVG stages' radii. Those were tuned against an export whose
    thread was a flat raster; live text at 10px goes to mush long before a
    picture of it does, so the same numbers read as damage rather than depth.
    These sit the thread back without ever making it look broken. */
const BLUR_BANDS = [
  { r: 0.2, from: 0.0, to: 0.3 },
  { r: 0.4, from: 0.2, to: 0.55 },
  { r: 0.8, from: 0.45, to: 0.8 },
  { r: 1.6, from: 0.7, to: 1.0 },
];
/** Height of the ramp, from the thread's foot upwards. Roughly what the frame
    shows of the thread, so the ramp lands in the visible part. */
const BLUR_RAMP = 190;
const ThreadBlur = () => (
  <For each={BLUR_BANDS}>
    {(b) => {
      const mask = `linear-gradient(to top, transparent ${(b.from * BLUR_RAMP).toFixed(0)}px, #000 ${(b.to * BLUR_RAMP).toFixed(0)}px)`;
      return (
        <div
          aria-hidden="true"
          style={{
            '-webkit-backdrop-filter': `blur(${b.r}px)`,
            '-webkit-mask-image': mask,
            'backdrop-filter': `blur(${b.r}px)`,
            inset: '-16px 0',
            'mask-image': mask,
            'pointer-events': 'none',
            position: 'absolute',
          }}
        />
      );
    }}
  </For>
);

// --- the thread's fixed content ---------------------------------------------

type Msg = {
  who: 'teo' | 'aidan';
  time: string;
  text: string;
  reaction?: boolean;
};
const THREAD: Msg[] = [
  {
    who: 'teo',
    time: '2:54 PM',
    text: 'Do we have the launch date and owners confirmed? Dana asked for the plan before the team call.',
    reaction: true,
  },
  {
    who: 'aidan',
    time: '3:00 PM',
    text: 'The Q3 launch plan is updated. Thursday at 9, and Dana has the email. We just need to check invites.',
  },
  {
    who: 'teo',
    time: '3:01 PM',
    text: 'I’ll check the invite flow before we share the plan.',
  },
  {
    who: 'aidan',
    time: '3:01 PM',
    text: 'Thanks. I’ll post anything I find here.',
    reaction: true,
  },
];
const FACE = { teo: avatarTeo, aidan: avatarAidan } as const;
const NAME = { teo: 'Teo', aidan: 'Aidan' } as const;

const Reaction = () => (
  <span class="tls-reactions">
    <span class="tls-reaction">
      <span style={{ 'font-size': '9px', 'line-height': '9px' }}>👀</span>1
    </span>
    <Ic icon={IconSmiley} w={10} color="#8b8b8b" />
  </span>
);

// --- cursor choreography ------------------------------------------------------

type CursorSeg = {
  from: number;
  to: number;
  target: string;
  appear?: boolean;
  /** Scales the trajectory noise -- the wobble and the arc, not the throw or
      its corrections. Below 1 for a move the hand makes deliberately. */
  steady?: number;
  /** Drops the overshoot-and-correct entirely, leaving a plain eased throw.
      For a move that flows straight into the next one: the corrections are a
      hand making sure of a target it is about to click, and they take up the
      back half of the segment, which on a move that is only passing through
      reads as a dead stop. */
  flow?: boolean;
};
/** Where the pointer goes and when. Targets are element names, measured from
    the DOM the first time a segment needs them (see measure()): the chips
    only exist once the composer is in task mode, and the mention only once
    the agent has posted, so nothing here can be a constant. */
const CURSOR: CursorSeg[] = [
  { from: TL.toToggle[0], to: TL.toToggle[1], target: 'toggle', appear: true },
  { from: TL.toAssignee[0], to: TL.toAssignee[1], target: 'assignee' },
  // No segment for either menu: once it is open the keyboard takes over, and
  // the pointer stays parked on the chip that opened it.
  { from: TL.toDue[0], to: TL.toDue[1], target: 'due' },
  // The committing move, and the longest, so it takes the most wobble of any
  // of them -- its amplitude scales with distance and this one hits the cap.
  // A hand going to send is steadier than one browsing a menu, so it gets less
  // of the drift while keeping the full throw-and-correct.
  { from: TL.toSend[0], to: TL.toSend[1], target: 'send', steady: 0.45 },
  // Back to the task that was just sent, then the short hop up to the expand
  // button its hover bar puts there. The second move is well under
  // BALLISTIC_MIN, so it lands without a throw-and-correct -- which is right:
  // a hand already on the row does not wind up for a target 60px away.
  { from: TL.toTaskMsg[0], to: TL.toTaskMsg[1], target: 'taskmsg', flow: true },
  { from: TL.toExpand[0], to: TL.toExpand[1], target: 'expand' },
  {
    from: TL.toMention[0],
    to: TL.toMention[1],
    target: 'mention',
    appear: true,
  },
];
// Mouse clicks only -- the two menu picks are Enter, and a click ring on a
// keystroke would be a lie.
const CLICKS = [
  TL.toggleClick,
  TL.assigneeClick,
  TL.dueClick,
  TL.sendClick,
  TL.expandClick,
];
/** Deterministic per-move variation, so no two crossings share a rhythm and
    every replay is still identical. */
const vary = (i: number, n: number) => {
  const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Smooth deterministic wobble in roughly [-1, 1]: two sines at
    incommensurate frequencies with a per-move phase, so it never repeats
    within a move and never repeats between moves. Hands do not travel on a
    ruled line -- and they do not hold perfectly still between corrections
    either, which is the most obviously synthetic part of a pointer that has
    otherwise been given a nice easing curve. */
const wobble = (u: number, i: number, axis: number) => {
  const p = vary(i, 10 + axis) * 6.283;
  return 0.62 * Math.sin(u * 5.3 + p) + 0.38 * Math.sin(u * 11.7 + p * 1.7);
};

/** Below this, in stage units, a move is a single confident motion. Picking a
    row out of an already-open menu is a short hop, and a hand does not throw
    and correct for those -- it only overshoots when the distance is long
    enough to be worth a ballistic swing. Applying the same profile to every
    move regardless of length is most of what makes synthetic cursors read as
    synthetic. */
const BALLISTIC_MIN = 78;
/** Overshoot as a fraction of the throw: nothing at all under BALLISTIC_MIN,
    ramping in above it, capped in absolute terms so the long haul to Send does
    not sail far past a button a few units wide. Varied per move. */
const overshoot = (len: number, i: number) => {
  if (len <= BALLISTIC_MIN) return 0;
  const ramp = Math.min(1, (len - BALLISTIC_MIN) / 58);
  return ramp * (0.7 + 0.6 * vary(i, 0)) * Math.min(0.05, 5 / len);
};

/** How a hand crosses a screen: one fast ballistic throw that carries past the
    mark, a pause while the eye checks it, then one or two small corrective
    hops onto the target -- the submovements Fitts's law describes. A single
    eased lerp has none of that and reads as a rail.
    `o` is the overshoot as a fraction of the distance; at 0 this collapses to
    one smooth motion, which is what short hops get. */
const travel = (k: number, o: number, i: number): number => {
  if (o <= 0) return ease(k);
  // When the throw ends, and whether the hand needs one correction or two.
  const kb = 0.54 + 0.12 * vary(i, 1);
  const twoHops = vary(i, 2) > 0.45;
  if (k <= kb) return (1 + o) * (1 - Math.pow(1 - clamp01(k / kb), 3));
  const rest = 1 - kb;
  // How far back the first correction carries, and when each hop lands. Both
  // vary per move: corrections that all undershoot by the same fraction on the
  // same beat are their own kind of tell.
  const back = -(0.2 + 0.35 * vary(i, 4));
  const h1 = 0.2 + 0.14 * vary(i, 5);
  const h2 = 0.54 + 0.14 * vary(i, 6);
  const h3 = 0.74 + 0.1 * vary(i, 7);
  // [time fraction, offset from the mark as a multiple of the overshoot].
  const keys: readonly (readonly [number, number])[] = twoHops
    ? [
        [kb, 1],
        [kb + rest * h1, 1],
        [kb + rest * h2, back],
        [kb + rest * h3, back],
        [1, 0],
      ]
    : [
        [kb, 1],
        [kb + rest * (0.36 + 0.16 * vary(i, 8)), 1],
        [1, 0],
      ];
  for (let j = 1; j < keys.length; j++) {
    const [k0, m0] = keys[j - 1];
    const [k1, m1] = keys[j];
    if (k <= k1 || j === keys.length - 1) {
      const u = k1 === k0 ? 1 : clamp01((k - k0) / (k1 - k0));
      return 1 + o * (m0 + (m1 - m0) * ease(u));
    }
  }
  return 1;
};

/** Which row a menu's keyboard highlight sits on. Arrow-up wraps to the bottom
    of the list and walks up to the row being taken, so the rows in between
    light up on the way past -- which is what picking from a menu looks like
    when your hands are already on the keys, and it saves the pointer a trip it
    would never really make. -1 before the first press: the menu opens with
    nothing highlighted. */
const highlightRow = (
  now: number,
  from: number,
  rows: number,
  target: number,
  step: number
) => {
  const i = Math.floor((now - from) / step);
  return i < 0 ? -1 : Math.max(target, rows - 1 - i);
};

/** Where an appearing cursor comes in from, relative to its first target. */
const APPEAR_FROM = { x: 46, y: 38 };
/** Stage units. The glyph fills its box now (the old dart used barely half
    of its 24), so this is smaller than the 20 it replaces and lands at the
    same visual weight beside the panel's 10px text. */
const CURSOR_SIZE = 12;

// =============================================================================

export function TasksLifecycleScene(props: { t: Accessor<number> }) {
  const t = props.t;
  const P = (a: number, b: number) => clamp01((t() - a) / (b - a));
  const E = (r: readonly [number, number]) => ease(P(r[0], r[1]));

  let root: HTMLDivElement | undefined;
  let proseEl: HTMLDivElement | undefined;

  // --- scale: the current view window onto whatever the frame measures ------
  // Seeded from the viewport so the 1440 prerender is right before hydration
  // (frame = min(1160, vw) - 48 of section padding), then measured for real.
  const seedW = Math.max(260, Math.min(1160, viewportWidth()) - 48);
  const [frameW, setFrameW] = createSignal(seedW);
  onMount(() => {
    const box = root?.parentElement;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      if (w > 0) setFrameW(w);
      // A new width means every measured target has moved.
      targets = {};
      setTargetsRev((n) => n + 1);
    });
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });
  /** The window the frame is looking at. On anything but a phone it is the
      whole artboard, so the desktop rendering is untouched. */
  const view = createMemo<View>(() => {
    if (!phone()) return DESKTOP_VIEW;
    // Weights, not a switch: the camera crosses between framings on the same
    // ramps the panels do. `c` unwinds over fadeOut so the loop seam hands
    // back a camera already on the opening framing.
    const b = clamp01(E(TL.swap) - E(TL.swapBack));
    const c = clamp01(E(TL.swapBack) - E(TL.fadeOut));
    const a = clamp01(1 - b - c);
    const mix = (k: keyof View) =>
      VIEWS.a[k] * a + VIEWS.b[k] * b + VIEWS.c[k] * c;
    return { w: mix('w'), x: mix('x'), y: mix('y') };
  });
  const scale = () => frameW() / view().w;

  // --- derived state ----------------------------------------------------------
  const typed = createMemo(() => {
    const now = t();
    let n = 0;
    while (n < CHAR_AT.length && CHAR_AT[n] <= now) n++;
    return n;
  });
  const typing = createMemo(() => t() >= TL.caretIn && t() < TL.toggleClick);
  /** The composer is a task composer from the toggle click until Send. */
  const taskMode = createMemo(
    () => t() >= TL.toggleClick && t() < TL.sendClick
  );
  // 0 until the toggle is clicked, ramps to 1 as it flips, then back down as Send
  // resets the composer. The middle branch is what stops "not task mode"
  // reading as "already reset" before the click has happened.
  const flip = () =>
    taskMode() ? E(TL.flip) : t() >= TL.sendClick ? 1 - E(TL.reset) : 0;
  /** Blends the toggle's two colour states along its own ramp. These were the
      only things on the stage using a CSS transition rather than the clock,
      which meant a step click seeked past the flip while the transition was
      still catching up -- and double-eased the colour against the ramp that
      was already driving the knob. */
  const mix = (on: string, off: string) =>
    `color-mix(in srgb, ${on} ${(flip() * 100).toFixed(1)}%, ${off})`;
  const proseOut = () => E(TL.proseOut);
  const taskIn = () => E(TL.taskIn);
  const chipsIn = () => E(TL.chipsIn);
  const assignee = createMemo(() => t() >= TL.teoPick);
  const due = createMemo(() => t() >= TL.tomorrowPick);
  const assigneeMenu = createMemo(
    () => t() >= TL.assigneeClick && t() < TL.teoPick
  );
  const dueMenu = createMemo(() => t() >= TL.dueClick && t() < TL.tomorrowPick);
  // Both menus hold three rows. Teo is the top one, so arrow-up passes Macro
  // and Aidan to reach it; Tomorrow is the middle, so it passes one. The last
  // press lands a beat before Enter, rather than on it.
  const assigneeHi = createMemo(() =>
    highlightRow(t(), TL.assigneeClick + 150, 3, 0, 190)
  );
  const dueHi = createMemo(() =>
    highlightRow(t(), TL.dueClick + 170, 3, 1, 200)
  );
  const posted = createMemo(() => t() >= TL.post[0]);
  const agentPosted = createMemo(() => t() >= TL.agentMsg[0]);
  /** The sent task link's hover state, and the action bar it raises. Both die
      at the end of the swap rather than at its start, so they fade out with
      the channel that carries them instead of blinking off in front of it --
      and both are back to 0 by the time the channel returns in phase 4. */
  const msgHover = createMemo(() =>
    t() >= TL.swap[1] ? 0 : ease(P(TL.taskMenu[0] - 40, TL.taskMenu[0] + 120))
  );
  const barIn = createMemo(() =>
    t() >= TL.swap[1] ? 0 : ease(P(TL.taskMenu[0], TL.taskMenu[1]))
  );
  /** The expand button lights as the pointer settles on it and stays lit
      through the click that opens the task. */
  const expandHot = createMemo(
    () => t() >= TL.toExpand[1] - 120 && t() < TL.swap[0]
  );
  const hovering = createMemo(() => t() >= TL.hover);

  const channelAmt = () => clamp01(1 - E(TL.swap) + E(TL.swapBack));
  /** The channel is the only thing on the stage through phases 1-2, and again
      at the top of phase 4, so it sits centred rather than hugging the right
      edge with a hole beside it. It gives the centre up to the task panel in
      phase 3 -- invisibly, since it is at zero opacity across that whole ramp
      -- and slides back to its SIDE-anchored home in phase 4 exactly as the
      preview card arrives. Tying the slide to the card is what makes it read:
      the card needs the left half, so it pushes the channel across, rather
      than the channel wandering off for no visible reason. */
  const centered = () => 1 - E(TL.cardShift);
  /** How far the channel currently sits from its SIDE-anchored home. */
  const channelDX = () => -CENTER_SHIFT * centered();
  const taskAmt = () =>
    clamp01(
      ease(P(TL.swap[0] + 150, TL.swap[1] + 150)) -
        ease(P(TL.swapBack[0], TL.swapBack[1] - 150))
    );
  const cardAmt = () => E(TL.cardIn);
  const sceneOpacity = () => Math.min(ease(P(0, 300)), 1 - E(TL.fadeOut));

  // Task panel
  /** Activity rows grow into place rather than arriving at full height. They
      sit in a bottom-anchored block (.tls-tp-body is space-between), so
      mounting one used to shove the Activity header and every row above it up
      by the row's whole height in a single frame -- while the row itself was
      still at zero opacity. That is the same reflow jolt contentH() exists to
      prevent on the composer, and it read as a jump followed by a fade rather
      than as a row arriving.
      ROW_SLOT folds in the 8px that used to be .tls-act-rows' flex gap: the
      gap has to grow with the row too, or the block still jumps by 8px the
      instant the slot appears. */
  const ROW_SLOT = 18;
  const rowIn = (at: number) => ease(P(at, at + 350));
  const done = createMemo(
    () => (t() >= TL.tick1 ? 1 : 0) + (t() >= TL.tick2 ? 1 : 0)
  );
  const barAmt = () =>
    ease(P(TL.tick1, TL.tick1 + 400)) + ease(P(TL.tick2, TL.tick2 + 400));
  /** Work starts when the agent opens the PR, so the chip flips there rather
      than two rows later. row3's wording moved with it. */
  const inProgress = createMemo(() => t() >= TL.row2);
  /** The task's status right now. Both mentions in the thread are links to the
      same task, so they have to show what it IS, not what it was when each
      message was sent: the one the user posted in phase 2 is still sitting in
      the thread in phase 4, by which point the task is closed. Freezing it at
      Created would be the one thing on this stage the product would never
      actually render. */
  const liveStatus = createMemo(() =>
    t() >= TL.agentMsg[0]
      ? { icon: StatusDone, color: '#15da43' }
      : t() >= TL.row2
        ? { icon: StatusInProgress, color: '#ffae00' }
        : { icon: StatusCreated, color: '#15da43' }
  );
  const statusPop = () => ease(P(TL.row2, TL.row2 + 300));

  // The composer's height is the one thing that cannot be a pure function of
  // t: how tall the typed prose stands depends on the font. So it is measured
  // once, as the morph begins, and the ramp runs from that to task-mode's
  // fixed 100 (title 17 + 8 + description 24 + 24 + chips 27).
  const H_EMPTY = 20;
  const [proseH, setProseH] = createSignal(32);
  /** Measured once, as the morph begins. The dependency has to be a memo: an
      `on` whose accessor reads t() re-runs on every frame of the clock, not
      just when the comparison flips, so this fired 60 times a second and
      eventually read the prose on the very frame Show detached it -- an
      offsetHeight of 0, which collapsed the ramp's start and made the box jump
      backwards mid-morph. A memo only propagates when the boolean itself
      changes; the h > 0 guard makes a detached read impossible to act on
      either way. */
  const growing = createMemo(() => t() >= TL.grow[0]);
  createEffect(
    on(growing, (g) => {
      if (!g || !proseEl) return;
      const h = proseEl.offsetHeight;
      if (h > 0) setProseH(h);
    })
  );
  /** The task block's own height, measured rather than assumed. It is what the
      box ramps TO, so a hardcoded guess that missed by a pixel would show up
      as a jump the moment the ramp handed the height back to `auto`. Read on
      mount, once per cycle, in a microtask -- by then Solid has inserted the
      element and offsetHeight is real. */
  const [taskH, setTaskH] = createSignal(100);
  const measureTask = (el: HTMLDivElement) => {
    queueMicrotask(() => {
      const h = el.offsetHeight;
      if (h > 0) setTaskH(h);
    });
  };
  /** The box's height is explicit for the whole of task mode, not just the
      morph. Handing back to `auto` partway through would make the swap depend
      on which children happen to be in flow at that instant, which is what a
      reflow jitter is. */
  const contentH = (): string => {
    const now = t();
    if (now >= TL.grow[0] && now < TL.grow[1])
      return `${lerp(proseH(), taskH(), E(TL.grow)).toFixed(2)}px`;
    if (now >= TL.grow[1] && now < TL.reset[0])
      return `${taskH().toFixed(2)}px`;
    if (now >= TL.reset[0] && now < TL.reset[1])
      return `${lerp(taskH(), H_EMPTY, E(TL.reset)).toFixed(2)}px`;
    return 'auto';
  };
  /** True exactly while contentH() is pinning a height -- which is when the
      prose has to come out of flow, so that removing it cannot move anything. */
  const pinned = () => t() >= TL.grow[0] && t() < TL.reset[1];

  // --- cursor -------------------------------------------------------------------
  let targets: Record<string, { x: number; y: number; dx: number }> = {};
  const [targetsRev, setTargetsRev] = createSignal(0);
  /** Centre of a named target in stage px. The root's own rect width against
      STAGE_W gives the effective scale, whatever the zoom chain above is. */
  const measure = (name: string) => {
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-tlc-target="${name}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = root.getBoundingClientRect();
    const k = s.width / STAGE_W;
    if (!k) return;
    targets[name] = {
      x: (r.left + r.width / 2 - s.left) / k,
      y: (r.top + r.height / 2 - s.top) / k,
      dx: channelDX(),
    };
    setTargetsRev((n) => n + 1);
  };
  const segIndex = createMemo(() => {
    let i = -1;
    for (let k = 0; k < CURSOR.length; k++) if (t() >= CURSOR[k].from) i = k;
    return i;
  });
  // Measure a segment's target as the cursor sets off for it -- by then the
  // element is on screen and its container has finished moving.
  createEffect(() => {
    const i = segIndex();
    if (i < 0) return;
    // Only measure while the panel hosting the targets is settled. It is
    // translated AND scaled through the phase-3 swap, and
    // getBoundingClientRect reports the transformed box -- meanwhile
    // segIndex() still names the last travelled segment for the whole of
    // phase 3. Without this guard, anyone who clicked step 3 before phase 2
    // had played measured the send button against a receded panel and cached
    // it ~25 units off for the rest of the session.
    if (channelAmt() < 0.995) return;
    const seg = CURSOR[i];
    targetsRev();
    if (!targets[seg.target]) measure(seg.target);
    if (i > 0 && !CURSOR[i].appear && !targets[CURSOR[i - 1].target])
      measure(CURSOR[i - 1].target);
  });
  /** Every cursor target lives inside the channel, so one measured while the
      channel sat centred has to follow it when it slides out of centre. Storing
      the offset in force at measurement time and re-adding the current one
      keeps the pointer on its mark without re-measuring on every frame. */
  const at = (name: string) => {
    const m = targets[name];
    return m ? { x: m.x + (channelDX() - m.dx), y: m.y } : undefined;
  };
  const cursorPos = createMemo(() => {
    targetsRev();
    const i = segIndex();
    if (i < 0) return null;
    const seg = CURSOR[i];
    const to = at(seg.target);
    if (!to) return null;
    const from = seg.appear
      ? { x: to.x + APPEAR_FROM.x, y: to.y + APPEAR_FROM.y }
      : at(CURSOR[i - 1]?.target);
    if (!from) return to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = P(seg.from, seg.to);
    const d = travel(k, seg.flow ? 0 : overshoot(len, i), i);
    // A lateral bow, so the path is an arc rather than a ruled line -- nobody
    // moves a mouse along a straight edge. Signed and scaled off the segment
    // index, so it varies from move to move but is identical on every replay,
    // which is what keeps the whole thing a pure function of t. Longer throws
    // bow more, up to a cap.
    const steady = seg.steady ?? 1;
    const bow =
      Math.min(len * 0.09, 12) *
      (vary(i, 3) * 2 - 1) *
      Math.sin(Math.PI * clamp01(d)) *
      steady;
    const away = leaving();
    // Wobble tapers to nothing as the move ends, so the pointer still lands
    // exactly on its mark -- everything else here is noise, this one bit is
    // not allowed to be.
    const amp = Math.min(len * 0.05, 5.5) * (1 - k) * steady;
    return {
      x: from.x + dx * d - (dy / len) * bow + wobble(k, i, 0) * amp + away * 13,
      y: from.y + dy * d + (dx / len) * bow + wobble(k, i, 1) * amp + away * 15,
    };
  });
  /** The pointer lifts away once the task has been opened, rather than hanging
      over a channel that is receding out from under it. It does NOT leave
      after Send any more: it has somewhere to go now, and the send button sits
      on the composer's bottom row, which is the edge that stays put while the
      box collapses back to one line. */
  const leaving = () =>
    t() >= TL.expandClick && t() < TL.toMention[0]
      ? ease(P(TL.expandClick + 120, TL.expandClick + 620))
      : 0;
  const cursorOpacity = () => {
    const now = t();
    if (now < TL.toToggle[0]) return 0;
    if (now < TL.toMention[0])
      return (
        ease(P(TL.toToggle[0], TL.toToggle[0] + 250)) *
        (1 - leaving()) *
        channelAmt()
      );
    return ease(P(TL.toMention[0], TL.toMention[0] + 250));
  };
  /** 0..1 over the 320ms after the most recent click, or 0. */
  const clickPulse = createMemo(() => {
    const now = t();
    for (let i = CLICKS.length - 1; i >= 0; i--) {
      if (now >= CLICKS[i]) return clamp01((now - CLICKS[i]) / 320);
    }
    return 0;
  });
  const pressing = () =>
    clickPulse() > 0 && clickPulse() < 1 ? Math.sin(clickPulse() * Math.PI) : 0;

  // --- render ---------------------------------------------------------------------
  const Message = (p: {
    who: 'teo' | 'aidan';
    time: string;
    reply?: boolean;
    last?: boolean;
    reaction?: boolean;
    children: JSX.Element;
    enter?: number;
  }) => (
    <div
      class={p.reply ? 'tls-reply' : 'tls-root'}
      style={
        p.enter !== undefined
          ? {
              opacity: p.enter,
              transform: `translateY(${((1 - p.enter) * 10).toFixed(2)}px)`,
            }
          : undefined
      }
    >
      <Show when={p.reply}>
        {/* The connector: down through the gap above, then a quarter-turn
            into this reply's avatar. Non-final replies carry the line on
            down to the next one, so the run reads as one continuous stem. */}
        <svg
          aria-hidden="true"
          class="tls-curve"
          width="18"
          height="29"
          viewBox="0 0 18 29"
        >
          <path
            d="M0.25 0V11A17.75 17.75 0 0 0 18 28.75"
            fill="none"
            stroke="#353535"
            stroke-width="0.5"
          />
        </svg>
        <Show when={!p.last}>
          <span aria-hidden="true" class="tls-stem" />
        </Show>
      </Show>
      <Show when={!p.reply && p.reaction}>
        <span aria-hidden="true" class="tls-stem tls-stem-root" />
      </Show>
      <div class="tls-msg">
        <Avatar
          src={FACE[p.who]}
          size={p.reply ? 24 : 28}
          ring={p.reply ? '#353535' : undefined}
        />
        <div class="tls-msg-body">
          <div class="tls-msg-head">
            <span class="tls-name">{NAME[p.who]}</span>
            <span class="tls-time">{p.time}</span>
          </div>
          <div class="tls-text">{p.children}</div>
        </div>
      </div>
      <Show when={p.reaction}>
        <div
          style={{
            'padding-left': p.reply ? '40px' : '44px',
            'margin-top': '4px',
          }}
        >
          <Reaction />
        </div>
      </Show>
    </div>
  );

  const Chip = (p: {
    children: JSX.Element;
    pl?: number;
    pr?: number;
    target?: string;
    muted?: boolean;
    class?: string;
    style?: JSX.CSSProperties;
    ref?: (el: HTMLSpanElement) => void;
  }) => (
    <span
      ref={p.ref}
      data-tlc-target={p.target}
      class={`tls-chip ${p.class ?? ''}`}
      style={{
        color: p.muted ? '#bfbfbf' : '#fff',
        'padding-left': `${p.pl ?? 5}px`,
        'padding-right': `${p.pr ?? 5}px`,
        ...p.style,
      }}
    >
      {p.children}
    </span>
  );
  const Caret = () => <Ic icon={IconCaretDown} w={8} color="#fff" />;

  const cursor = cursorPos;

  return (
    <div
      ref={root}
      aria-hidden="true"
      class="tls"
      /* left/top pan the artboard behind the frame; zoom scales them with
         everything else, so the window's top-left lands on the frame's. */
      style={{
        left: `${(-view().x).toFixed(2)}px`,
        opacity: sceneOpacity(),
        top: `${(-view().y).toFixed(2)}px`,
        zoom: scale(),
      }}
    >
      <style>{`
        .tls, .tls * { box-sizing: border-box; }
        .tls {
          color: #fff;
          font-family: ${appFont};
          height: ${STAGE_H}px;
          left: 0;
          position: absolute;
          top: 0;
          width: ${STAGE_W}px;
          -webkit-font-smoothing: antialiased;
        }
        .tls-avatar { border-radius: 999px; display: block; flex: none; object-fit: cover; }
        .tls-u { text-decoration: underline; text-decoration-thickness: from-font; text-underline-offset: 1px; }
        .tls-at { color: #ff8f00; font-weight: 500; }
        .tls-mention { border-radius: 3px; padding: 0 1px; margin: 0 -1px; text-decoration: underline; text-decoration-thickness: from-font; text-underline-offset: 1px; white-space: nowrap; }
        .tls-mention .tls-u { text-decoration: none; }

        /* Panels. Each wrapper is positioned in stage px and carries the
           drop-shadow -- which also makes it the backdrop root the thread
           blur samples, so the bands see only the panel beneath them. The
           zoom sits on the child so the wrapper's offsets stay in stage px. */
        .tls-channel { bottom: ${SIDE}px; filter: drop-shadow(0 26px 54px rgb(0 0 0 / 0.5)); position: absolute; right: ${SIDE}px; transform-origin: 100% 100%; width: ${CHANNEL_W}px; }
        .tls-taskwrap { filter: drop-shadow(0 26px 54px rgb(0 0 0 / 0.5)); left: 50%; margin-left: -341.95px; position: absolute; top: 77px; transform-origin: 50% 40%; width: 683.9px; }
        /* Two layers, not one. This card is a popover that opens OVER the
           channel panel, so it has to read as lifted off it -- and a single
           wide-blur black shadow has almost nothing to darken on a stage this
           dark, which is why the one it had was invisible. The tight layer is
           the contact shadow that actually separates the edge; the broad one
           carries the height. */
        .tls-cardwrap { filter: drop-shadow(0 3px 8px rgb(0 0 0 / 0.6)) drop-shadow(0 20px 44px rgb(0 0 0 / 0.7)); left: ${SIDE}px; position: absolute; top: 40px; transform-origin: 100% 60%; width: 364.8px; z-index: 3; }
        .tls-zoom { zoom: ${PANEL_ZOOM}; position: relative; }

        /* The chat panel's skin: a half-pixel gradient ring, the #060709
           face, and the "Panel Glint" wash -- the three layers the export
           drew. The glint is clipped to the face's own radius here, which is
           the square corner we had to clip away on every SVG stage. */
        .tls-skin { background: linear-gradient(108.95deg, rgba(206,206,206,0.4) 8.06%, rgba(0,0,0,0.25) 45.3%, rgba(125,83,51,0.4) 114.1%); border-radius: 14.5px; inset: 0; pointer-events: none; position: absolute; z-index: 0; }
        .tls-skin::before { background: #060709; border-radius: 14px; content: ''; inset: 0.5px; position: absolute; }
        /* The "Panel Glint" wash the exports draw across their top-left
           corner. All three panels carry one -- here, .tls-taskpanel::before
           and .tls-card::before -- and all three are turned down from the
           opacities Figma states, for a reason that only applies on this page:
           the frame these sit in already runs a top-lit --c1 gradient of its
           own, so each panel is being lit twice. The export had to draw the
           whole of its own lighting because it stood on a neutral canvas.
           Normalised on effective peak white rather than on the stated
           opacity, since the task panel's gradient starts at 0.4 alpha and the
           other two start solid -- scaling the three numbers as written would
           have left it at a third of the others instead of level with them.
           Peaks land at roughly .06 / .036 / .045, a little over half of what
           each was. */
        .tls-skin::after { background: linear-gradient(124.4deg, #fff 30.1%, rgba(255,255,255,0) 56.1%); border-radius: 14px; content: ''; inset: 0.5px; opacity: 0.06; position: absolute; }
        .tls-chat { position: relative; width: 386px; z-index: 1; }

        .tls-header { align-items: center; border-bottom: 0.5px solid #353535; display: flex; justify-content: space-between; padding: 8px 8px 8px 16px; }
        .tls-header-l { align-items: center; display: flex; gap: 16px; }
        .tls-chan { align-items: center; display: flex; font-size: 10px; font-weight: 600; gap: 4px; line-height: 12px; }
        .tls-tabs { background: #000; border: 0.5px solid #1f1f1f; border-radius: 7px; display: flex; gap: 4px; padding: 2.5px; }
        .tls-tab { border-radius: 5px; color: #8b8b8b; font-size: 10px; font-weight: 500; line-height: 12px; padding: 3px 6px 4px; }
        .tls-tab.on { background: #16191f; border: 0.5px solid #353535; color: #fff; padding: 2.5px 5.5px 3.5px; }
        .tls-sq { align-items: center; background: #16191f; border: 0.5px solid #353535; border-radius: 7px; color: #bfbfbf; display: flex; height: 24px; justify-content: center; width: 24px; }

        .tls-body { display: flex; flex-direction: column; gap: 32px; padding: 16px 8px 8px; }
        .tls-thread { display: flex; flex-direction: column; gap: 16px; position: relative; }
        .tls-root, .tls-reply { position: relative; }
        .tls-reply { padding-left: 32px; }
        .tls-msg { align-items: flex-start; display: flex; gap: 10px; padding: 1px 6px; }
        .tls-msg-body { display: flex; flex: 1 1 0; flex-direction: column; gap: 3px; min-width: 0; }
        .tls-msg-head { align-items: flex-start; display: flex; font-size: 10px; justify-content: space-between; line-height: 13px; }
        .tls-name { color: #fff; font-weight: 600; }
        .tls-time { color: #8b8b8b; white-space: nowrap; }
        .tls-text { color: #fff; font-size: 10px; line-height: 13px; padding-right: 64px; }
        .tls-reply .tls-msg-body { gap: 4px; }
        .tls-reply .tls-msg-head { line-height: 12px; padding-bottom: 2px; }
        .tls-reply .tls-text { line-height: 12px; padding-right: 16px; }
        /* Thread stem: hangs from the root avatar's centre (x 20) and each
           reply's curve peels off it into that reply's avatar. */
        /* The rail is ONE unbroken vertical at x 20 -- the root avatar's centre
           -- with a curve branching off it into each reply's avatar. The stem
           used to start at 13px, which is below the point the curve turns
           right, so the line simply stopped for 18px under every reply. It now
           starts at the top of the gap above, overlapping the curve's own
           vertical run; they are the same colour, so the overlap is invisible
           and the continuity is guaranteed rather than fitted.
           Both are centred on 20: the curve's path sits at x 0.25 inside its
           box with a 0.5 stroke, so its box goes at 19.75 too, not 20. */
        .tls-stem { background: #353535; bottom: -16px; left: 19.75px; position: absolute; top: -16px; width: 0.5px; }
        .tls-stem-root { top: 29px; bottom: -16px; }
        .tls-curve { left: 19.75px; overflow: visible; position: absolute; top: -16px; }
        .tls-reactions { align-items: center; display: inline-flex; gap: 4px; }
        .tls-reaction { align-items: center; background: #16191f; border: 0.5px solid #353535; border-radius: 4px; color: #8b8b8b; display: inline-flex; font-size: 8px; font-weight: 500; gap: 4px; height: 17px; line-height: 1; padding: 4px; }

        /* Composer */
        .tls-composer { background: #0d0e10; border: 0.5px solid #353535; border-radius: 10px; display: flex; flex-direction: column; padding: 8px 4px 4px 6px; position: relative; width: 100%; }
        .tls-content { overflow: hidden; position: relative; }
        .tls-prose { color: #fff; font-size: 10px; line-height: 12px; padding: 0 2px 8px; }
        .tls-caret { background: #fff; display: inline-block; height: 10px; margin-left: 1px; vertical-align: -1px; width: 1px; }
        @keyframes tlsCaret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @media (prefers-reduced-motion: no-preference) { .tls-caret { animation: tlsCaret 1.05s steps(1) infinite; } }
        .tls-taskblock { display: flex; flex-direction: column; gap: 8px; padding: 0 6px; }
        .tls-title { color: #fff; font-size: 14px; font-weight: 600; line-height: 17px; }
        .tls-desc { color: #fff; font-size: 10px; line-height: 12px; }
        .tls-chips { align-items: center; display: flex; gap: 8px; margin-top: 24px; padding: 4px 0 4px 4px; }
        .tls-chip { align-items: center; background: #16191f; border: 0.5px solid #353535; border-radius: 999px; display: inline-flex; font-size: 8px; gap: 4px; height: 19px; line-height: 10px; padding: 3px 5px; position: relative; white-space: nowrap; }
        .tls-dash { border: 1px dashed #8b8b8b; border-radius: 999px; height: 12px; width: 12px; }
        .tls-toolbar { align-items: center; display: flex; justify-content: space-between; }
        .tls-tools { align-items: center; color: #8b8b8b; display: flex; gap: 8px; padding: 0 2px; }
        .tls-pill { align-items: center; background: #16191f; border: 0.5px solid #353535; border-radius: 999px; display: inline-flex; gap: 3px; height: 19px; padding: 2px 5px; }
        .tls-pill-label { font-size: 8px; line-height: 10px; width: 18px; }
        .tls-toggle { border-radius: 4.5px; height: 9px; position: relative; width: 14px; }
        .tls-knob { background: #16191f; border-radius: 999px; height: 7px; position: absolute; top: 1px; width: 7px; }
        .tls-send { border-radius: 6px; display: grid; padding: 4px; place-items: center; }
        /* The action bar a chat row raises when you point at it: sat on the
           row's top edge at the right, clear of the text. Same segmented
           construction as the task panel's Share|Link group, at message
           scale. */
        .tls-taskanchor { display: inline-flex; position: relative; }
        .tls-hoverbar { align-items: stretch; background: #16191f; border: 0.5px solid #353535; border-radius: 6px; box-shadow: 0 6px 16px rgb(0 0 0 / 0.55); color: #8b8b8b; display: flex; left: -3px; padding: 0.5px; position: absolute; top: calc(100% + 5px); z-index: 6; }
        .tls-hoverbar > span { align-items: center; display: flex; justify-content: center; padding: 3px; }
        .tls-hoverbar > span + span { border-left: 0.5px solid #353535; padding-left: 2.5px; }
        .tls-hoverbar > span.hot { background: rgba(255,255,255,0.09); color: #fff; }

        .tls-menu { background: #16191f; border: 0.5px solid #353535; border-radius: 7px; bottom: calc(100% + 6px); box-shadow: 0 8px 18px rgb(0 0 0 / 0.45); display: flex; flex-direction: column; gap: 1px; left: 0; min-width: 92px; padding: 3px; position: absolute; z-index: 5; }
        .tls-menu-row { align-items: center; border-radius: 5px; color: #fff; display: flex; font-size: 8px; gap: 6px; line-height: 10px; padding: 4px 6px; white-space: nowrap; }
        .tls-menu-row.hi { background: rgba(255,255,255,0.07); }

        /* Posted task message: a compact task row inside a chat message. */
        .tls-taskmsg { align-items: center; display: flex; gap: 7px; }
        .tls-taskmeta { align-items: center; display: inline-flex; gap: 5px; }
        .tls-minichips { align-items: center; display: flex; gap: 4px; }
        .tls-minichips .tls-chip { height: auto; padding: 3px 5px 3px 4px; }
        .tls-agent-tag { border: 0.5px solid #353535; border-radius: 4px; color: #8b8b8b; font-size: 8px; font-weight: 500; line-height: 10px; margin-left: 6px; padding: 0 3px; }

        /* Task panel (600x350) */
        .tls-taskpanel { background: #0d0e10; border: 0.5px solid rgba(206,206,206,0.4); border-radius: 14px; display: flex; flex-direction: column; height: 350px; overflow: hidden; padding: 8px; position: relative; width: 600px; }
        .tls-taskpanel::before { background: linear-gradient(131.84deg, rgba(255,255,255,0.4) 14.6%, rgba(255,255,255,0) 37.6%); content: ''; height: 300px; left: -0.5px; opacity: 0.09; pointer-events: none; position: absolute; top: -0.5px; width: 328px; }
        .tls-tp-header { align-items: center; display: flex; justify-content: space-between; padding: 0 0 8px 8px; }
        .tls-tp-title { align-items: center; display: flex; font-size: 10px; font-weight: 600; gap: 4px; line-height: 12px; }
        .tls-tp-right { align-items: center; display: flex; gap: 8px; }
        /* A rounded track that CLIPS its fill, rather than the export's two
           interlocking halves. The export draws the bar at 2/3 -- fill rounded
           on the left and square on the right, track square on the left and
           rounded on the right -- which only reads correctly while there IS a
           fill. This animation starts at 0/3, where that construction shows a
           track with one square end. Clipping gives the same hard fill/track
           boundary the export has, and a proper pill at both 0/3 and 3/3. */
        .tls-bar { background: #353535; border-radius: 999px; height: 4px; overflow: hidden; width: 66px; }
        /* display: block is load-bearing -- these are spans, and the fill only
           got blockified before because the track was a flex container. An
           inline box ignores width and height, so without this the fill is
           0x0 at every value of t and the bar never fills. */
        .tls-bar-fill { background: #15da43; display: block; height: 4px; }
        /* Share | Link. Two changes from the export: the halves are the same
           width, and the whole control sits back.
           The export pads the first 6px either side and the second 4px, so its
           two halves are 24 and 20 -- fine in a static frame where the divider
           is the only thing marking them, less so here where the control is
           the one piece of chrome in a corner the eye already goes to. Equal
           padding makes the divider land on the centre.
           Faint: it drops from the #292b2f raised surface to the #16191f every
           other chip in this scene uses, and its glyphs from #bfbfbf to the
           #8b8b8b muted tier. Nothing in the story happens here -- it is a
           corner affordance, and at full strength it was competing with the
           task title beside it. */
        .tls-btngroup { align-items: stretch; background: #16191f; border: 0.5px solid #353535; border-radius: 7px; color: #8b8b8b; display: flex; padding: 0.5px; }
        .tls-btngroup > span { align-items: center; display: flex; justify-content: center; padding: 4px 5px; }
        /* The divider lives inside the second half's box, so its padding gives
           back the 0.5px it costs -- otherwise the two outer widths differ by
           exactly the hairline and the divider is not on the midpoint. */
        .tls-btngroup > span + span { border-left: 0.5px solid #353535; padding-left: 4.5px; }
        .tls-tp-chips { align-items: center; display: flex; gap: 8px; padding: 4px 0 4px 8px; }
        .tls-tp-chips .tls-chip { font-size: 10px; height: auto; line-height: 12px; }
        .tls-tp-body { display: flex; flex: 1 1 0; flex-direction: column; justify-content: space-between; min-height: 0; padding: 8px 0 4px 8px; }
        .tls-tp-desc { color: #fff; font-size: 10px; line-height: 12px; }
        .tls-checks { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .tls-check { align-items: center; display: flex; font-size: 10px; gap: 8px; line-height: 12px; padding: 0 4px; }
        .tls-box { border-radius: 3px; display: grid; flex: none; height: 10px; place-items: center; width: 10px; }
        .tls-act-head { align-items: center; color: #bfbfbf; display: flex; font-size: 8px; gap: 4px; line-height: 10px; padding: 4px 0; }
        .tls-hair { background: #353535; height: 0.5px; }
        .tls-act-rows { display: flex; flex-direction: column; padding-left: 12px; position: relative; }
        /* The row sits at the BOTTOM of its slot, so as the slot's height ramps
           the row rises into view and the 8px folded into ROW_SLOT lands above
           it -- exactly where the flex gap used to put it. */
        .tls-act-slot { align-items: flex-end; display: flex; overflow: hidden; }
        /* The slot is a flex row, so its row would shrink-wrap and strand the
           timestamp beside the text; grow it so space-between reaches the same
           right edge as row 1, which stretches as a column-flex child. */
        .tls-act-slot > .tls-act { flex: 1 1 auto; min-width: 0; }
        .tls-act-line { background: #353535; bottom: 5px; left: 16.75px; position: absolute; top: 5px; width: 0.5px; }
        .tls-act { align-items: flex-start; display: flex; font-size: 8px; justify-content: space-between; line-height: 10px; position: relative; }
        .tls-act-l { align-items: center; display: flex; gap: 4px; }
        .tls-act-t { color: #8b8b8b; white-space: nowrap; }
        .tls-comment { border: 0.5px solid #353535; border-radius: 10px; display: flex; flex-direction: column; gap: 4px; margin-top: 16px; padding: 8px 4px 4px 6px; }

        /* Preview card (320x210) */
        .tls-card { background: #0d0e10; border: 0.5px solid rgba(206,206,206,0.4); border-radius: 8px; display: flex; flex-direction: column; height: 210px; overflow: hidden; position: relative; width: 320px; }
        .tls-card::before { background: linear-gradient(137.8deg, #fff 30.1%, rgba(255,255,255,0) 56.1%); content: ''; height: 209px; left: -0.5px; opacity: 0.045; pointer-events: none; position: absolute; top: 0.5px; width: 320px; }
        /* Header mirrors the task panel's: title left, checklist bar + count right. */
        .tls-card-head { align-items: center; display: flex; font-size: 10px; font-weight: 600; gap: 8px; justify-content: space-between; line-height: 12px; padding: 12px; }
        .tls-card-title { align-items: center; display: flex; gap: 4px; min-width: 0; }
        .tls-card-right { align-items: center; display: flex; flex: none; gap: 6px; }
        .tls-card-count { align-items: center; display: flex; font-weight: 400; gap: 4px; }
        /* Same button group as the panel, tightened for the 320-wide card:
           even padding all round, and a radius scaled to the shorter box. */
        .tls-card-right .tls-btngroup { border-radius: 4px; }
        .tls-card-right .tls-btngroup > span { padding: 3px; }
        .tls-card-right .tls-btngroup > span + span { padding-left: 2.5px; }
        .tls-card-props { border-bottom: 0.5px solid #353535; padding: 0 12px 12px; }
        .tls-card-row { align-items: center; display: flex; height: 29px; justify-content: space-between; padding: 4px 0 8px; }
        .tls-card-acts { display: flex; flex-direction: column; gap: 8px; padding: 4px 12px 0; position: relative; }
        .tls-card-acts .tls-act-line { left: 16.75px; top: 5px; bottom: 5px; }
        .tls-card-foot { color: #8b8b8b; display: flex; flex: 1 1 0; flex-direction: column; font-size: 8px; justify-content: flex-end; line-height: 10px; padding: 12px; }

        .tls-cursor { left: 0; pointer-events: none; position: absolute; top: 0; z-index: 6; }
        .tls-ring { border: 1.5px solid rgba(255,255,255,0.6); border-radius: 999px; pointer-events: none; position: absolute; z-index: 5; }
      `}</style>

      {/* ---------------- channel panel ---------------- */}
      <div
        class="tls-channel"
        style={{
          opacity: channelAmt(),
          transform: `translateX(${((1 - channelAmt()) * 28 - CENTER_SHIFT * centered()).toFixed(2)}px) scale(${(1 - (1 - channelAmt()) * 0.03).toFixed(4)})`,
          visibility: channelAmt() > 0.001 ? 'visible' : 'hidden',
        }}
      >
        <div class="tls-zoom" style={{ width: '386px' }}>
          <div class="tls-skin" />
          <div class="tls-chat">
            <div class="tls-header">
              <div class="tls-header-l">
                <span class="tls-chan">
                  <Ic icon={IconChannel} w={11} color="#a2b2ff" />
                  {CHANNEL}
                </span>
                <span class="tls-tabs">
                  <span class="tls-tab on">Messages</span>
                  <span class="tls-tab">Attachments</span>
                </span>
              </div>
              <span class="tls-sq">
                <Ic icon={IconPhone} w={10} />
              </span>
            </div>

            <div class="tls-body">
              <div class="tls-thread">
                <For each={THREAD}>
                  {(m, i) => (
                    <Message
                      who={m.who}
                      time={m.time}
                      reply={i() > 0}
                      last={i() === THREAD.length - 1}
                      reaction={m.reaction}
                    >
                      {m.text}
                    </Message>
                  )}
                </For>

                {/* The task, sent into the channel */}
                <Show when={posted()}>
                  <Message who="aidan" time="3:04 PM" enter={E(TL.post)}>
                    <span class="tls-taskmsg">
                      {/* The bar hangs off the link, not the row: what is being
                          pointed at is the task, and what the bar offers acts
                          on the task. Anchored under it rather than over it --
                          above, it would cover this message's own name and
                          time, which sit directly on top of the link. */}
                      <span class="tls-taskanchor">
                        <Mention
                          icon={IconTask}
                          w={11}
                          color="#15da43"
                          target="taskmsg"
                          hot={msgHover() > 0.5}
                        >
                          {TASK_TITLE}
                        </Mention>
                        {/* Rendered from the moment the task posts rather than
                            when it opens, so the expand button has a box to
                            measure before the pointer sets off for it --
                            opacity 0 still lays out, a <Show> does not. */}
                        <span
                          aria-hidden="true"
                          class="tls-hoverbar"
                          style={{
                            opacity: barIn(),
                            transform: `translateY(${((1 - barIn()) * -3).toFixed(2)}px)`,
                          }}
                        >
                          <span>
                            <Ic icon={IconSmiley} w={11} />
                          </span>
                          <span>
                            <Ic icon={IconReply} w={11} />
                          </span>
                          <span
                            class={expandHot() ? 'hot' : ''}
                            data-tlc-target="expand"
                          >
                            <Ic icon={IconArrowsOut} w={11} />
                          </span>
                          <span>
                            <Ic icon={IconDots} w={11} />
                          </span>
                        </span>
                      </span>
                      <TaskMeta status={liveStatus()} />
                    </span>
                  </Message>
                </Show>

                {/* The agent reports back */}
                <Show when={agentPosted()}>
                  <div
                    class="tls-root"
                    style={{
                      opacity: E(TL.agentMsg),
                      transform: `translateY(${((1 - E(TL.agentMsg)) * 10).toFixed(2)}px)`,
                    }}
                  >
                    <div class="tls-msg">
                      <AgentDisc size={28} />
                      <div class="tls-msg-body">
                        <div class="tls-msg-head">
                          <span
                            style={{
                              'align-items': 'center',
                              display: 'inline-flex',
                            }}
                          >
                            <span class="tls-name">Macro</span>
                            <span class="tls-agent-tag">Agent</span>
                          </span>
                          <span class="tls-time">6:21 PM</span>
                        </div>
                        <div
                          class="tls-text"
                          style={{ 'padding-right': '16px' }}
                        >
                          Merged{' '}
                          <Mention icon={IconGithub} w={8} color="#fff">
                            {PR_TITLE}
                          </Mention>{' '}
                          — invited teammates keep their team.
                          {/* The task on its own line rather than mid-sentence:
                              it carries the same trailing glyphs the sent task
                              does, and three of them wedged between "closed"
                              and the rest of the clause read as debris. */}
                          <span
                            class="tls-taskmsg"
                            style={{ 'margin-top': '5px' }}
                          >
                            <Mention
                              icon={IconTask}
                              w={11}
                              color="#15da43"
                              target="mention"
                              hot={hovering()}
                            >
                              {TASK_TITLE}
                            </Mention>
                            <TaskMeta status={liveStatus()} />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Show>

                <ThreadBlur />
              </div>

              {/* ---------------- composer ---------------- */}
              {/* The border stays neutral in both modes. Task mode is already
                  said by the toggle, the send tint and the whole content of the
                  box changing; ringing it green as well read as a validation
                  state rather than a mode. */}
              <div class="tls-composer">
                <div class="tls-content" style={{ height: contentH() }}>
                  {/* Message-mode prose. Kept in the DOM through the morph so its
                      height can be measured; hidden once it has lifted out. */}
                  <Show when={!taskMode() || proseOut() < 1}>
                    <div
                      ref={proseEl}
                      class="tls-prose"
                      style={{
                        ...(pinned() ? PIN : null),
                        opacity: taskMode()
                          ? 1 - proseOut()
                          : posted()
                            ? E([TL.reset[0] + 120, TL.reset[1] + 120])
                            : 1,
                        transform: taskMode()
                          ? `translateY(${(-6 * proseOut()).toFixed(2)}px)`
                          : undefined,
                      }}
                    >
                      <Show
                        when={typed() > 0 && !posted()}
                        fallback={
                          <span style={{ color: '#8b8b8b' }}>
                            Message #{CHANNEL}
                          </span>
                        }
                      >
                        {ISSUE.slice(0, typed())}
                      </Show>
                      <Show when={typing()}>
                        <span aria-hidden="true" class="tls-caret" />
                      </Show>
                    </div>
                  </Show>

                  <Show when={taskMode()}>
                    <div
                      ref={measureTask}
                      style={{
                        ...PIN,
                        opacity: taskIn(),
                        transform: `translateY(${((1 - taskIn()) * 8).toFixed(2)}px)`,
                      }}
                    >
                      <div class="tls-taskblock">
                        <div class="tls-title">{TASK_TITLE}</div>
                        <div class="tls-desc">
                          Two teammates lost their team after opening an invite
                          link. First reported in{' '}
                          <Mention icon={IconChannel} w={11} color="#fff">
                            {CHANNEL}
                          </Mention>
                          .
                        </div>
                      </div>
                      <div
                        class="tls-chips"
                        style={{
                          opacity: chipsIn(),
                          transform: `translateY(${((1 - chipsIn()) * 6).toFixed(2)}px)`,
                        }}
                      >
                        <Chip pl={4}>
                          <Ic icon={StatusCreated} w={10} color="#15da43" />{' '}
                          Created <Caret />
                        </Chip>
                        <Chip>
                          <Ic
                            icon={PriorityHigh}
                            w={12}
                            h={8}
                            color="#bfbfbf"
                          />{' '}
                          High <Caret />
                        </Chip>
                        <Chip pl={3} target="assignee" muted={!assignee()}>
                          <Show
                            when={assignee()}
                            fallback={
                              <>
                                <span class="tls-dash" /> Assignee
                              </>
                            }
                          >
                            <Avatar src={avatarTeo} size={12} ring="#16191f" />{' '}
                            Teo
                          </Show>
                          <Caret />
                          <Show when={assigneeMenu()}>
                            <span class="tls-menu">
                              <span
                                class={`tls-menu-row ${assigneeHi() === 0 ? 'hi' : ''}`}
                              >
                                <Avatar src={avatarTeo} size={10} /> Teo
                              </span>
                              <span
                                class={`tls-menu-row ${assigneeHi() === 1 ? 'hi' : ''}`}
                              >
                                <Avatar src={avatarAidan} size={10} /> Aidan
                              </span>
                              <span
                                class={`tls-menu-row ${assigneeHi() === 2 ? 'hi' : ''}`}
                              >
                                <AgentDisc size={10} /> Macro
                              </span>
                            </span>
                          </Show>
                        </Chip>
                        <Chip target="due" muted={!due()}>
                          <Ic icon={IconCalendar} w={12} color="#bfbfbf" />
                          {due() ? 'Sep 12' : 'Due Date'}
                          <Caret />
                          <Show when={dueMenu()}>
                            <span class="tls-menu">
                              <span
                                class={`tls-menu-row ${dueHi() === 0 ? 'hi' : ''}`}
                              >
                                Today
                              </span>
                              <span
                                class={`tls-menu-row ${dueHi() === 1 ? 'hi' : ''}`}
                              >
                                Tomorrow
                              </span>
                              <span
                                class={`tls-menu-row ${dueHi() === 2 ? 'hi' : ''}`}
                              >
                                Select date…
                              </span>
                            </span>
                          </Show>
                        </Chip>
                      </div>
                    </div>
                  </Show>
                </div>

                <div class="tls-toolbar">
                  <span class="tls-tools">
                    <Ic icon={IconPaperclip} w={10} />
                    <Ic icon={IconTextAa} w={10} />
                    <span class="tls-pill" data-tlc-target="toggle">
                      <span
                        class="tls-toggle"
                        style={{ background: mix('#15da43', '#8b8b8b') }}
                      >
                        <span
                          class="tls-knob"
                          style={{ left: `${lerp(1, 6, flip()).toFixed(2)}px` }}
                        />
                      </span>
                      <span
                        class="tls-pill-label"
                        style={{ color: mix('#fff', '#8b8b8b') }}
                      >
                        Task
                      </span>
                    </span>
                  </span>
                  <span
                    class="tls-send"
                    data-tlc-target="send"
                    style={{
                      background: mix(
                        'rgba(21,218,67,0.2)',
                        'rgba(162,178,255,0.2)'
                      ),
                      transform: `scale(${(1 - (t() >= TL.sendClick && t() < TL.sendClick + 200 ? Math.sin(P(TL.sendClick, TL.sendClick + 200) * Math.PI) * 0.12 : 0)).toFixed(3)})`,
                    }}
                  >
                    <Ic
                      icon={IconArrowUp}
                      w={14}
                      color={mix('#15da43', '#a2b2ff')}
                    />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- task panel ---------------- */}
      <div
        class="tls-taskwrap"
        style={{
          opacity: taskAmt(),
          transform: `translateY(${((1 - taskAmt()) * 24).toFixed(2)}px) scale(${(0.96 + taskAmt() * 0.04).toFixed(4)})`,
          visibility: taskAmt() > 0.001 ? 'visible' : 'hidden',
        }}
      >
        <div class="tls-zoom" style={{ width: '600px' }}>
          <div class="tls-taskpanel">
            <div class="tls-tp-header">
              <span class="tls-tp-title">
                <Ic icon={IconTask} w={11} color="#15da43" />
                {TASK_TITLE}
              </span>
              <span class="tls-tp-right">
                <span
                  style={{
                    'align-items': 'center',
                    display: 'inline-flex',
                    gap: '4px',
                  }}
                >
                  <span class="tls-bar">
                    <span
                      class="tls-bar-fill"
                      style={{ width: `${((barAmt() / 3) * 66).toFixed(2)}px` }}
                    />
                  </span>
                  <span style={{ 'font-size': '10px', 'line-height': '12px' }}>
                    {done()}/3
                  </span>
                </span>
                <span class="tls-btngroup">
                  <span>
                    <Ic icon={IconShare} w={12} />
                  </span>
                  <span>
                    <Ic icon={IconLink} w={12} />
                  </span>
                </span>
              </span>
            </div>

            <div class="tls-tp-chips">
              <Chip
                pl={4}
                style={{
                  transform: `scale(${(1 + Math.sin(statusPop() * Math.PI) * 0.06).toFixed(3)})`,
                }}
              >
                <Show
                  when={inProgress()}
                  fallback={
                    <>
                      <Ic icon={StatusCreated} w={10} color="#15da43" /> Created
                    </>
                  }
                >
                  <Ic icon={StatusInProgress} w={10} color="#ffae00" /> In
                  Progress
                </Show>
                <Caret />
              </Chip>
              <Chip>
                <Ic icon={PriorityHigh} w={12} h={8} color="#bfbfbf" /> High{' '}
                <Caret />
              </Chip>
              <Chip pl={3}>
                <Avatar src={avatarTeo} size={12} ring="#16191f" /> Teo{' '}
                <Caret />
              </Chip>
              <Chip pl={3} pr={3}>
                <Ic icon={IconGitBranch} w={12} color="#bfbfbf" />
              </Chip>
            </div>

            <div class="tls-tp-body">
              <div>
                <div class="tls-tp-desc">
                  Fix the invite handoff before Thursday’s launch. Two teammates
                  lost their team. First reported in{' '}
                  <Mention icon={IconChannel} w={11} color="#fff">
                    {CHANNEL}
                  </Mention>
                  .
                </div>
                <div class="tls-checks">
                  <For
                    each={[
                      'Reproduce the invite redirect',
                      'Preserve the team through onboarding',
                      'Test the first-run experience',
                    ]}
                  >
                    {(label, i) => {
                      const isDone = () => done() > i();
                      return (
                        <div class="tls-check">
                          <span
                            class="tls-box"
                            style={{
                              background: isDone() ? '#15da43' : 'transparent',
                              border: isDone() ? 'none' : '0.5px solid #8b8b8b',
                            }}
                          >
                            <Show when={isDone()}>
                              <Ic icon={IconCheck} w={8} color="#292b2f" />
                            </Show>
                          </span>
                          <span
                            style={{
                              'text-decoration': isDone()
                                ? 'line-through'
                                : 'none',
                              'text-decoration-thickness': 'from-font',
                            }}
                          >
                            {label}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>

              <div>
                <div class="tls-act-head">
                  <span class="tls-hair" style={{ width: '9px' }} />
                  <Ic icon={IconCaretDown} w={8} color="#bfbfbf" />
                  Activity
                  <span class="tls-hair" style={{ flex: '1 1 0' }} />
                </div>
                <div class="tls-act-rows">
                  <span aria-hidden="true" class="tls-act-line" />
                  <div class="tls-act">
                    <span class="tls-act-l">
                      <Avatar src={avatarAidan} size={10} />
                      {/* The hash takes the row's own ink, like the one in the
                          description above it -- periwinkle here put a second
                          accent on a line that already has an orange @name. */}
                      <span>
                        <span class="tls-at">@aidan</span> created this task in{' '}
                        <Mention icon={IconChannel} w={8}>
                          {CHANNEL}
                        </Mention>
                      </span>
                    </span>
                    <span class="tls-act-t">4:16 PM</span>
                  </div>
                  <div
                    class="tls-act-slot"
                    style={{
                      height: `${(ROW_SLOT * rowIn(TL.row2)).toFixed(2)}px`,
                    }}
                  >
                    <div class="tls-act" style={{ opacity: rowIn(TL.row2) }}>
                      <span class="tls-act-l">
                        <ActivityDisc icon={IconPullRequest} />
                        <span>
                          <span class="tls-at">@Macro</span> opened a fix PR:{' '}
                          <Mention icon={IconGithub} w={8} color="#fff">
                            {PR_TITLE}
                          </Mention>
                        </span>
                      </span>
                      <span class="tls-act-t">6:10 PM</span>
                    </div>
                  </div>
                  <div
                    class="tls-act-slot"
                    style={{
                      height: `${(ROW_SLOT * rowIn(TL.row3)).toFixed(2)}px`,
                    }}
                  >
                    <div class="tls-act" style={{ opacity: rowIn(TL.row3) }}>
                      <span class="tls-act-l">
                        <ActivityDisc icon={IconPullRequest} />
                        <span>
                          <span class="tls-at">@Macro</span> pushed 2 commits
                          and checked off 2 items
                        </span>
                      </span>
                      <span class="tls-act-t">6:10 PM</span>
                    </div>
                  </div>
                </div>
                <div class="tls-comment">
                  <span
                    style={{
                      color: '#8b8b8b',
                      'font-size': '8px',
                      'font-weight': '500',
                      'line-height': '10px',
                      padding: '0 2px',
                    }}
                  >
                    Leave a comment...
                  </span>
                  <div class="tls-toolbar">
                    <span class="tls-tools">
                      <Ic icon={IconPaperclip} w={12} />
                      <Ic icon={IconTextAa} w={12} />
                    </span>
                    {/* White, per node 906:15409 -- the frame's own asset for
                        this arrow is fill="white" (only the message composer's
                        is #a2b2ff). The rgba(255,255,255,0.1) plate exists to
                        make it the box's one bright affordance; at the muted
                        tier it read as disabled. */}
                    <span
                      class="tls-send"
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    >
                      <Ic icon={IconArrowUp} w={14} color="#fff" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- preview card ---------------- */}
      <div
        class="tls-cardwrap"
        style={{
          opacity: cardAmt(),
          transform: `translateX(${((1 - cardAmt()) * -18).toFixed(2)}px) scale(${(0.96 + cardAmt() * 0.04).toFixed(4)})`,
          visibility: cardAmt() > 0.001 ? 'visible' : 'hidden',
        }}
      >
        <div class="tls-zoom" style={{ width: '320px' }}>
          <div class="tls-card">
            <div class="tls-card-head">
              <span class="tls-card-title">
                <Ic icon={IconTask} w={12} color="#15da43" />
                {TASK_TITLE}
              </span>
              <span class="tls-card-right">
                <span class="tls-card-count">
                  <span class="tls-bar" style={{ width: '40px' }}>
                    <span class="tls-bar-fill" style={{ width: '40px' }} />
                  </span>
                  3/3
                </span>
                <span class="tls-btngroup">
                  <span>
                    <Ic icon={IconShare} w={10} />
                  </span>
                  <span>
                    <Ic icon={IconLink} w={10} />
                  </span>
                </span>
              </span>
            </div>
            <div class="tls-card-props">
              <div class="tls-card-row">
                <span class="tls-minichips">
                  <Chip pl={4}>
                    <Ic icon={StatusDone} w={8} color="#15da43" /> Completed
                  </Chip>
                  <Chip pl={4}>
                    <Ic icon={PriorityHigh} w={8} h={6} color="#bfbfbf" /> High
                  </Chip>
                  <Chip pl={3}>
                    <Avatar src={avatarTeo} size={10} ring="#16191f" /> Teo
                  </Chip>
                </span>
              </div>
            </div>
            <div class="tls-card-acts">
              <span
                aria-hidden="true"
                class="tls-act-line"
                style={{ top: '9px' }}
              />
              <div class="tls-act">
                <Ic icon={IconDots} w={10} color="#353535" />
              </div>
              <div class="tls-act">
                <span class="tls-act-l">
                  <Avatar src={avatarTeo} size={10} />
                  <span>
                    <span class="tls-at">@teo</span> merged a PR:{' '}
                    <Mention icon={IconGithub} w={8} color="#fff">
                      {PR_TITLE}
                    </Mention>
                  </span>
                </span>
                <span class="tls-act-t">6:20 PM</span>
              </div>
              <div class="tls-act">
                <span class="tls-act-l">
                  <Ic icon={StatusDone} w={10} color="#15da43" />
                  <span>
                    <span class="tls-at">@Macro</span> closed this task with
                    status Completed
                  </span>
                </span>
                <span class="tls-act-t">6:21 PM</span>
              </div>
            </div>
            <div class="tls-card-foot">
              <span>
                Closed by <span style={{ 'font-weight': '500' }}>@Macro</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- cursor ---------------- */}
      <Show when={cursor()}>
        {(pos) => (
          <>
            <Show when={pressing() > 0}>
              <span
                aria-hidden="true"
                class="tls-ring"
                style={{
                  height: `${(16 + clickPulse() * 16).toFixed(1)}px`,
                  left: `${(pos().x - (16 + clickPulse() * 16) / 2).toFixed(2)}px`,
                  opacity: (1 - clickPulse()) * cursorOpacity(),
                  top: `${(pos().y - (16 + clickPulse() * 16) / 2).toFixed(2)}px`,
                  width: `${(16 + clickPulse() * 16).toFixed(1)}px`,
                }}
              />
            </Show>
            <span
              aria-hidden="true"
              class="tls-cursor"
              style={{
                opacity: cursorOpacity(),
                transform: `translate(${(pos().x - CURSOR_SIZE * CURSOR_TIP).toFixed(2)}px, ${(pos().y - CURSOR_SIZE * CURSOR_TIP).toFixed(2)}px) scale(${(1 - pressing() * 0.14).toFixed(3)})`,
                'transform-origin': `${(CURSOR_SIZE * CURSOR_TIP).toFixed(3)}px ${(CURSOR_SIZE * CURSOR_TIP).toFixed(3)}px`,
              }}
            >
              <Pointer size={CURSOR_SIZE} />
            </span>
          </>
        )}
      </Show>
    </div>
  );
}
