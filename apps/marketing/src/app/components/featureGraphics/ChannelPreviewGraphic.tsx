import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconArrowUp from '../../../assets/icons/chat-scene/arrow-up.svg';
import IconCall from '../../../assets/icons/chat-scene/call.svg';
import IconHash from '../../../assets/icons/chat-scene/channel-hash.svg';
import IconCompose from '../../../assets/icons/chat-scene/compose.svg';
import IconEye from '../../../assets/icons/chat-scene/eye.svg';
import IconEyeSlash from '../../../assets/icons/chat-scene/eye-slash.svg';
import IconPaperclip from '../../../assets/icons/chat-scene/paperclip.svg';
import IconSearch from '../../../assets/icons/chat-scene/search.svg';
import IconSortAscending from '../../../assets/icons/chat-scene/sort-ascending.svg';
import IconTaskGlyph from '../../../assets/icons/chat-scene/task-glyph.svg';
import IconTaskPriority from '../../../assets/icons/chat-scene/task-priority.svg';
import IconTaskStatus from '../../../assets/icons/chat-scene/task-status.svg';
import IconTextAa from '../../../assets/icons/chat-scene/text-aa.svg';
import ThreadElbow from '../../../assets/icons/chat-scene/thread-elbow.svg';
import IconCaretDown from '../../../assets/icons/phosphor/caret-down.svg';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJacob from '../../../assets/people/jacob-work.webp';
import avatarJulia from '../../../assets/people/julia.webp';
import avatarTeo from '../../../assets/people/teo.webp';
import { createVisible } from '../../utils/utilVisible';

// ---------------------------------------------------------------------------
// The channel list opening its preview pane — one HTML scene, scrubbed by
// the page's scroll.
//
// Everything on screen is a pure function of `t` (ms into the open). No timers, transitions or tween state live in the markup, only
// `prog(a, b)` ramps read off `t` — the mechanism ChannelCohesionGraphic uses
// (ChannelsGraphics.tsx:1569) and the one TasksLifecycleScene generalises.
// That is what makes the scene seekable and gives SSR a sensible fixed frame
// for free.
//
// One ramp drives the whole thing. `split` runs 0 -> 1: at 0 the list owns
// the full frame and every row shows its latest message, at 1 the list has
// narrowed to a 224px rail of names and the message pane fills what is left.
// The rail clips its own overflow, so the rows' trailing content is cut by
// the same width change that moves everything else, exactly as it would be in
// the app.
//
// The reader drives it. There is no clock: t is read off the frame's own
// position in the viewport (see SCRUB_FROM / SCRUB_TO), so scrolling down
// opens the preview and scrolling back up closes it again, at whatever
// speed the reader moves. This is only possible because every frame is a
// pure function of t -- nothing in the scene accumulates -- which is what
// the ramps above buy. The first paint (SSR included) is the closed list,
// which is the frame the open is a departure from.
//
// Geometry. Laid out at a fixed 918x390 CSS px — the Figma artboard (file
// IOH8EtjS7V8rmxnbJzFZ2A, nodes 1053:6075 and 537:7916) — and `zoom`ed to the
// frame's measured width, so every number below is the design's number
// verbatim. `zoom` rather than `transform` because it reflows: text is laid
// out at its final size and stays crisp.
// ---------------------------------------------------------------------------

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const STAGE_W = 918;
export const STAGE_H = 390;
/** What the list narrows to once the preview pane is open. */
const RAIL_W = 224;
/** Fixed for both header layouts. The frames draw the wide one at 40 and the
    narrow at 30, but honouring both would move every row below by 10px on a
    toggle that is meant to be purely horizontal. The wide value wins because
    it is the one with 24px controls to fit; the narrow layout centres its
    shorter row inside it. */
const HEAD_H = 40;

// A beat to register the list, then a 260ms open -- panel-open speed, not
// scene speed. Every opacity ramp below derives from the same `split`, so
// they tighten with it and there is one duration here to change.
/* The scene's parameter space. These read as milliseconds because the scene
   used to be played by a clock; scrolling drives it now, so what they really
   are is the share of the scroll each beat gets. Out of 1200:

     0 - 90       closed, while the figure comes into view
     90 - 1010    the open -- 77% of the scroll, and the point of the scene
     1010 - 1080  settled, a beat before anything is annotated
     1080 - 1200  the callouts, 10% of the scroll

   The callouts arrive after the open rather than during it: they point at
   positions in the open state, so before it they would be pointing at
   nothing. Keeping them to a tenth of the travel makes them read as a label
   appearing on a finished picture rather than as a second animation. */
const TL = {
  openStart: 90,
  openEnd: 1010,
  notesStart: 1080,
  notesEnd: 1200,
  /* The last thing the scroll does is resolve the labels: they draw in at
     the connector's own grey, then lift out of it. Kept to its own beat
     after the leaders have finished so it reads as the annotation settling,
     not as part of the arrival -- and so the reader has something to reach
     at the bottom of the scrub rather than the scene simply stopping. */
  litStart: 1200,
  litEnd: 1300,
};
/** The whole scrub, in the same units. */
const TL_END = TL.litEnd;

/** The label size, in stage units. 12 rather than the docs figure's 14
    because the two figures are laid out differently: that one is 801 units
    across and occupies 74% of its column, this one is 918 and occupies all of
    it, so the same number would render this one about a third larger. 12 puts
    the two at the same size on the page, which is what is being matched. */
const NOTE_FS = 12;
/** The scrub window, as the frame's top edge in viewport heights: the scene
    is closed while its top is below 1.02vh and fully open by the time it
    reaches 0.24vh. Most of a screen of scrolling -- about 700px on a laptop
    -- so the open unfolds rather than snaps.

    Both ends are against something. The start is just under the fold, so
    the reader gets the closed list as the section arrives and every unit of
    scroll after that does visible work. The end cannot go much higher: the
    top callouts sit NOTE_ZONE_TOP above the frame, about 90px at the usual
    render width, and they have to clear the site header at the moment they
    land -- 0.24 keeps them clear down to a 700px-tall window. */
const SCRUB_FROM = 1.02;
const SCRUB_TO = 0.24;
/** Room above and below the stage for the labels, in stage units. Each zone
    is its leader's overshoot past the stage edge, plus NOTE_GAP, plus two
    lines at 12/1.4 (34): the top's leaders stop 32 above the frame, the
    bottom's 34 below it. Change a leader's end and these have to follow, or
    the label is clipped. */
const NOTE_ZONE_TOP = 74;
const NOTE_ZONE_BOT = 76;
const FIG_H = STAGE_H + NOTE_ZONE_TOP + NOTE_ZONE_BOT;
/** Where the stage starts, as a fraction of the whole figure. */
const FRAME_TOP_PCT = (NOTE_ZONE_TOP / FIG_H) * 100;
/** Clearance between a label and the end of its own leader, in stage units. */
const NOTE_GAP = 8;
/** Each label sits just past where its leader stops, so the two are tied
    together: lengthen a leader and its label follows it out. */
const noteEdgePct = (n: { at: 'top' | 'bottom'; pts: number[][] }) => {
  const endY = n.pts[n.pts.length - 1][1];
  const wrapperY = NOTE_ZONE_TOP + endY;
  return n.at === 'top'
    ? ((FIG_H - (wrapperY - NOTE_GAP)) / FIG_H) * 100
    : ((wrapperY + NOTE_GAP) / FIG_H) * 100;
};
/** Narrowed with the type, so all three notes still take two lines rather
    than one going short. The two above span 55-325 and 492-762 of the
    stage's 918, so they do not meet. */
const NOTE_W = 270;

/*
 * PLACEHOLDER COPY -- written to hold the shape, not to ship as is.
 *
 * Callout geometry, all of it in stage units. `pts` is the leader's polyline:
 * the first point is the dot on the feature, the rest are its vertices, and
 * the last always leaves the stage so the leader arrives at the label square.
 * `labelX` is the label's centre. It sits on the x of its leader's final,
 * vertical run, so the text is centred over or under the line that arrives
 * at it rather than merely somewhere near it.
 *
 * The vertices are not free. Each leader has to get into a corridor that is
 * clear all the way out, and the settled stage has only three, measured:
 *
 *   x 141.5-164.9  the rail header's gap between the Recent pill and the two
 *                  icon buttons, clear on down through the toolbar
 *   x 537-889      the pane header's gap between the tabs and the call
 *                  button, over message rows whose ink stops well short of it
 *   x 225-297      the pane's own left gutter, clear to the bottom edge
 *                  because the messages and the composer both start at 297.4
 */
const NOTES = [
  {
    // The Recent dropdown. The dot is only 9 units below the stage's top
    // edge, so nearly all of this leader's length is the run outside the
    // frame.
    at: 'top' as const,
    pts: [
      [141.5, 21],
      [157.5, 5],
      [157.5, -32],
    ],
    labelX: 157.5,
    label:
      'Relevant conversations float to the top, and less important stuff settles below',
  },
  {
    // The collapsed thread. Leaves the chip's right end rather than its left,
    // because the left side would have to cross the avatar column to reach a
    // corridor and the right side has the pane header's gap directly above.
    at: 'top' as const,
    pts: [
      [583.4, 130],
      [627, 86],
      [627, -32],
    ],
    labelX: 627,
    label:
      'Replies make a single inline thread, rather than opening another window or infinitely nesting',
  },
  {
    // The @mentioned task. The dot is on the row's TOP edge rather than its
    // middle, which is what lets this turn at 45 degrees like the other two:
    // the diagonal has to cross the 24-unit avatar column, and the only
    // window wide enough is the gap between Jacob's avatar (ends y 184.3) and
    // Rahul's (starts y 226.6). From y 196.6 the line passes 14.14 units from
    // Rahul's centre against a 12-unit radius -- the avatars are circles, so
    // it clears the corner of the box it looks like it should clip.
    at: 'bottom' as const,
    // The dot sits left of the task row and level with it -- x 323 against
    // the glyph's 337.4, y 202.6 on the row's centre line -- which lands it
    // in the gap between Jacob's avatar (ends y 184.3) and Rahul's (starts
    // y 226.6), 31 and 37 units from their centres.
    //
    // The dot sets the line rather than sitting on a fixed one: moving it
    // sideways at a constant height re-derives x + y = 525.6, and the elbow's
    // y follows from the corridor's x. Which is why it clears better than it
    // used to -- 20.08 units off Rahul's centre now, against 14.14 before.
    //
    // The elbow is at x 265, in the pane's own left gutter -- measured
    // clear: the pane starts at 225 and everything inside it, the message
    // avatars and the composer alike, starts at 297.5. That leaves the
    // diagonal 82 units and the vertical 163, so the turn reads as a short
    // arm off the feature onto a line that carries the label, rather than a
    // long diagonal with a stub on the end. Shortening the diagonal cannot
    // introduce a collision: every point of it was already on the old,
    // longer one.
    // Checked the whole way: it nicks only the 0.5px rail/pane border at
    // y 300.6 and enters the rail at x 217 / y 308.6 -- where the rows' name
    // ink has already stopped at 161.9, so there is nothing under it.
    pts: [
      [323, 202.6],
      [265, 260.6],
      [265, 424],
    ],
    labelX: 265,
    label:
      '@mention a task and it arrives as a smart link, carrying its status, priority, and assignee',
  },
];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Ease OUT, for the beats that still play themselves: the callouts leave
    immediately and decelerate in. */
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type Row = {
  name: string;
  /** A person row shows a face or initials where a channel shows its glyph. */
  avatar?: string;
  initials?: string;
  sender: string;
  message: string;
  time: string;
  unread?: boolean;
  active?: boolean;
};

const ROWS: Row[] = [
  {
    name: 'bug-reports',
    sender: 'Teo',
    message:
      'Confirmed on staging - flags are back. Thanks for dealing with this quickly!',
    time: '5:06 PM',
    unread: true,
    active: true,
  },
  {
    name: 'Jacob',
    avatar: avatarJacob,
    sender: 'Jacob',
    message:
      'Hey! New graphics in onboarding flow look great. Can we add a tasteful animation to the SVGs in stage 4 and 5?',
    time: '4:29 PM',
    unread: true,
  },
  {
    name: 'customer feedback',
    sender: 'Teo',
    message: 'Can fix the automation tools',
    time: '3:52 PM',
    unread: true,
  },
  {
    name: 'design-system',
    sender: 'You',
    message:
      'Just pushed the updated token set. Check the new spacing scale when you get a chance',
    time: '2:40 PM',
    unread: true,
  },
  {
    name: 'Megan',
    initials: 'ME',
    sender: 'Megan',
    message: 'Can you review the onboarding mockups before standup tomorrow?',
    time: '2:18 PM',
  },
  {
    name: 'eng-standup',
    sender: 'Teo',
    message: 'Wrapping up the auth refactor today. PR is up for review',
    time: '1:30 PM',
  },
  {
    name: 'ship-it',
    sender: 'Julia',
    message: 'v2.4.1 is live! Release notes are in the thread',
    time: '12:49 PM',
  },
  {
    name: 'Tyler',
    initials: 'TY',
    sender: 'Tyler',
    message: "Lunch at the Thai place? I'm heading out in 10",
    time: '11:55 AM',
  },
  {
    name: 'product-updates',
    sender: 'Teo',
    message:
      "Revised the Q3 roadmap based on last week's retro. Link in thread",
    time: '11:20 AM',
  },
  {
    name: 'Julia',
    avatar: avatarJulia,
    sender: 'You',
    message:
      'Sent you the file for the new settings page. Let me know your thoughts',
    time: '10:34 AM',
  },
  {
    name: 'frontend',
    sender: 'Peter',
    message:
      'Anyone else seeing a flicker on the dropdown? Might be a re-render loop',
    time: '10:02 AM',
  },
  {
    name: 'random',
    sender: 'Jacob',
    message:
      'Office snack restock happening Friday - drop your requests in the thread',
    time: '9:41 AM',
  },
  {
    name: 'incidents',
    sender: 'hutch',
    message:
      'Resolved: API latency spike was due to a misconfigured cache header',
    time: '9:13 AM',
  },
  {
    name: 'remote',
    sender: 'Julia',
    message: 'Working from the Lisbon office this week if anyone is around',
    time: '8:58 AM',
  },
];

/** The channel the pane is showing — the selected row, so the rail highlight,
    the pane header and the composer placeholder can never drift apart. The
    Figma composer reads "growth team" while its header reads "bug-reports";
    this is the header's. */
const PREVIEWED = ROWS.find((r) => r.active)!.name;

type Msg = {
  who: string;
  avatar?: string;
  initials?: string;
  time: string;
  text: JSX.Element;
  /** Indented under the message above it, as a thread reply. */
  reply?: boolean;
};

/**
 * `still` holds the scene on frame zero -- the list view, before the preview
 * opens -- with no clock, no callouts and no label zones. It is the closing
 * hero's backdrop: the same list the section below animates, ghosted behind
 * the panels, so the two are the same picture rather than two drawings of
 * one idea.
 */
export function ChannelPreviewGraphic(props: { still?: boolean } = {}) {
  const [t, setT] = createSignal(0);
  const [frameW, setFrameW] = createSignal(STAGE_W);
  let frameEl: HTMLDivElement | undefined;

  // A margin either side of the viewport, so the reader is never scrubbing
  // a scene whose loop has not been started yet -- the gate only decides
  // whether the loop runs, and the scroll position decides the frame.
  const visible = createVisible(() => frameEl, '25%');
  const prog = (a: number, b: number) => clamp01((t() - a) / (b - a));

  onMount(() => {
    if (frameEl && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(([e]) =>
        setFrameW(e.contentRect.width || STAGE_W)
      );
      ro.observe(frameEl);
      onCleanup(() => ro.disconnect());
    }
    // The still variant still needs the observer above -- it is what scales
    // the artboard to its box -- but nothing after it.
    if (props.still) return;
    const reduce =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Reduced motion gets the end frame outright: the preview being open is
    // the point, so it should not be the one thing motion buys you.
    if (reduce) {
      setT(TL_END);
      return;
    }

    // The scene is scrubbed by the scroll rather than played by a clock:
    // the reader opens the preview by scrolling into the section and closes
    // it by scrolling back out. Every frame is already a pure function of
    // `t`, so this only changes where t comes from.
    //
    // The frame's own top against the viewport is what drives it, read on
    // the rAF rather than from a scroll event: the page scrolls a container
    // rather than the window, and a rect is true whichever ancestor moved,
    // with no listener to attach to the right one. The loop only runs while
    // the visibility gate is open.
    let raf = 0;
    const tick = () => {
      if (frameEl) {
        const vh = window.innerHeight || 1;
        const top = frameEl.getBoundingClientRect().top;
        setT(
          clamp01((SCRUB_FROM * vh - top) / ((SCRUB_FROM - SCRUB_TO) * vh)) *
            TL_END
        );
      }
      raf = requestAnimationFrame(tick);
    };
    createEffect(() => {
      if (!visible()) return;
      raf = requestAnimationFrame(tick);
      onCleanup(() => cancelAnimationFrame(raf));
    });
  });

  /** 0 = list owns the frame, 1 = rail + preview pane. Monotonic in t, and
      t now follows the scroll in both directions. */
  /* Linear, where every other ramp here eases. The open is the part the
     reader is driving: an ease-out would run most of the width change in the
     first third of the scroll and then crawl, which reads as the panel
     coming unstuck from the scroll. The reader's own scrolling supplies the
     dynamics. */
  const split = createMemo(() => prog(TL.openStart, TL.openEnd));
  const railW = () => lerp(STAGE_W, RAIL_W, split());
  /** The rows' trailing half leaves early, so the rail is not still carrying
      text at the width where there is no room for it. */
  const trailOpacity = () => 1 - clamp01(split() * 3);
  /** The pane arrives just behind the width, once there is room for it. */
  const paneOpacity = () => clamp01((split() - 0.2) / 0.45);
  /** The header's two layouts cross in the middle of the width change, so
      neither is on screen at a width it was not drawn for. Complementary on
      one band rather than two ramps with their own ends: sized separately
      they left a gap where both sat at zero and the header blanked. */
  // Late in the width change, not early: the wide layout is pinned at full
  // width so the rail simply clips its right end as it goes, which reads as
  // the rail cutting it off. Swapping early instead left the narrow layout --
  // pinned at 224 -- floating in a rail still twice that wide.
  const headCross = () => clamp01((split() - 0.55) / 0.4);
  /** Opening a channel marks it read, so the row being previewed drops its
      unread dot -- just behind the pane arriving, so it reads as a
      consequence of the open rather than part of it. Only that row: the
      other unread channels were not opened. It stays cleared, since the
      clock never runs backwards. */
  const unreadOpacity = () => 1 - clamp01((split() - 0.3) / 0.4);
  /** The callouts, once the stage has settled into the shape they point at. */
  const notesIn = createMemo(() => ease(prog(TL.notesStart, TL.notesEnd)));
  /** The last beat: 0 = the annotation sits in the grey it arrived in,
      1 = line, dot and label have all come up out of it together. */
  const notesLit = createMemo(() => ease(prog(TL.litStart, TL.litEnd)));
  const wideHead = () => 1 - headCross();
  const narrowHead = () => headCross();

  const scale = () => frameW() / STAGE_W;

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

  const Avatar = (p: {
    src?: string;
    initials?: string;
    size: number;
    font: number;
  }) => (
    <Show
      when={p.src}
      fallback={
        <div
          class="cpg-initials"
          style={{
            'font-size': `${p.font}px`,
            height: `${p.size}px`,
            width: `${p.size}px`,
          }}
        >
          {p.initials}
        </div>
      }
    >
      <img
        src={p.src}
        alt=""
        class="cpg-face"
        style={{ height: `${p.size}px`, width: `${p.size}px` }}
      />
    </Show>
  );

  const MESSAGES: Msg[] = [
    {
      who: 'Gabriel',
      avatar: avatarGabriel,
      time: '2:20 PM',
      text: 'Does anyone know why our posthog flags are broken?',
    },
    {
      who: 'Rahul',
      initials: 'RA',
      time: '2:20 PM',
      text: 'Which ones',
      reply: true,
    },
    {
      who: 'Gabriel',
      avatar: avatarGabriel,
      time: '2:21 PM',
      text: 'all of them, flags just return false',
      reply: true,
    },
    {
      who: 'Jacob',
      avatar: avatarJacob,
      time: '4:29 PM',
      text: (
        <>
          <span class="cpg-mention">@sean</span> filed this so it doesn't get
          lost:
        </>
      ),
    },
    {
      who: 'Rahul',
      initials: 'RA',
      time: '5:03 PM',
      text: 'Pushed a fix. Can someone verify on staging?',
    },
    {
      who: 'Teo',
      avatar: avatarTeo,
      time: '5:06 PM',
      text: 'Confirmed on staging - flags are back. Thanks for dealing with this quickly!',
    },
  ];

  return (
    <div class={props.still ? 'cpg-fig cpg-still' : 'cpg-fig'}>
      <style>{`
        /* The figure is the stage plus a label zone above and below. Below
           the gate at the bottom of this block it collapses back to the
           stage's own ratio and the callouts are not drawn at all. */
        .cpg-fig {
          aspect-ratio: ${STAGE_W} / ${STAGE_H};
          container-type: inline-size;
          position: relative;
          width: 100%;
        }
        .cpg-leads, .cpg-note { display: none; }
        /* Terminal vocabulary lifted from RouteDocuments' hero callouts,
           which took it from the /email compose figure: a dot on the
           feature, a hairline leader, and bare text. No pill, no border, no
           background, no uppercase. Both the connector and the label are
           grey here rather than the docs figure's accent -- orange on the
           line and on the label made the annotation compete with the scene
           it annotates. Sizes are restated in stage
           units -- the docs figure is 801 wide and this one 918, so a value
           copied across would render smaller. */
        .cpg-leads {
          height: 100%;
          left: 0;
          pointer-events: none;
          position: absolute;
          top: 0;
          width: 100%;
          z-index: 4;
        }
        /* One ink for the whole connector -- line and dot -- and it travels
           with the labels on the last beat: dim while the leaders draw, then
           up to the muted text colour, which still leaves it a step under
           the label's own end colour. Opaque at both ends, so the hairline
           stays crisp rather than thinning as it lightens. The two ends live
           here and the frame sets only the mix between them, on the svg. */
        .cpg-leads {
          --cpg-lead-dim: color-mix(in srgb, var(--c4) 62%, var(--b0));
          --cpg-lead-ink: var(--cpg-lead-dim);
        }
        .cpg-lead { fill: none; stroke: var(--cpg-lead-ink); stroke-width: 1; }
        /* Not .cpg-dot: that is the rail's unread indicator. The two never
           collided in effect -- one is a div background, the other an SVG
           fill -- but they answer the same selector, which is a trap for the
           next rule or query that wants only one of them. */
        .cpg-leaddot { fill: var(--cpg-lead-ink); }
        .cpg-note {
          /* The colour is the scene's last beat and is set per frame on the
             element; this is the frame it starts from, and what SSR and a
             reader who never scrolls this far get. */
          color: var(--c4);
          /* Cyberreader at its Light 300, the page's own reading face rather
             than the docs figure's rajdhani: these labels are prose about
             the picture, and at the regular weight they had more presence
             than the hairline pointing at them. The two paragraph tiers on
             /tasks are set the same way. */
          font-family: cyberreader, body;
          font-weight: 300;
          /* In stage units, so every clearance measured in stage units holds
             at whatever width the figure ends up. */
          font-size: ${((NOTE_FS / STAGE_W) * 100).toFixed(4)}cqw;
          line-height: 1.4;
          margin: 0;
          position: absolute;
          text-align: center;
          translate: -50% 0;
          width: ${((NOTE_W / STAGE_W) * 100).toFixed(4)}%;
          z-index: 4;
        }
        .cpg-frame {
          border-radius: 14.5px;
          /* Contains the keylight's screen blend, so it lifts the scene and
             not whatever the page happens to put behind the section. */
          isolation: isolate;
          left: 0;
          position: absolute;
          top: 0;
          width: 100%;
        }
        /* Illustration treatment. Two layers over the scene, neither of
           which the scene itself knows about:

           1. The scene fades toward its own edges, so the frame stops reading
              as a screenshot with a hard border and starts reading as a thing
              drawn on the page. It bottoms out well short of 0 -- the corners
              should soften, not disappear.
           2. A light pooling slightly above centre, which is where the eye
              lands and the only part that should feel fully lit.

           There was a third: a backdrop-filter blur masked to the inverse of
           the fade, so focus fell off with the opacity. Dropped -- the
           transparency alone does the softening, and the blur was smearing
           10px type that has little to spare. */
        /* The radii are percentages of the BOX, not of the half-box, so 50%
           already reaches the edge midpoints and ~70% reaches the corners.
           These were first written at 115%/128%, which put the entire falloff
           outside the frame and made the treatment invisible. */
        .cpg-fade {
          -webkit-mask-image: radial-gradient(66% 74% at 50% 44%, #000 38%, rgb(0 0 0 / 0.92) 70%, rgb(0 0 0 / 0.62) 100%);
          mask-image: radial-gradient(66% 74% at 50% 44%, #000 38%, rgb(0 0 0 / 0.92) 70%, rgb(0 0 0 / 0.62) 100%);
        }
        .cpg-keylight {
          background: radial-gradient(42% 58% at 50% 38%, rgb(232 232 232 / 0.05) 0%, rgb(232 232 232 / 0.018) 46%, transparent 78%);
          border-radius: inherit;
          inset: 0;
          mix-blend-mode: screen;
          pointer-events: none;
          position: absolute;
        }
        .cpg, .cpg * { box-sizing: border-box; }
        /* Grayscale antialiasing, matching the rule the page already applies
           to svg text. macOS defaults to subpixel AA, which thickens stems
           and reads a notch heavier than the Figma source -- and since this
           scene is DOM rather than SVG, the page's own svg-text rule missed
           it, leaving it the only graphic here still rendering subpixel. */
        .cpg {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          /* Transparent, and the visible edge is .cpg-rim below. Kept
             rather than removed so the box metrics do not move: with
             border-box sizing, dropping it would hand 2px back to the
             interior and shift everything inside. */
          border: 1px solid transparent;
          border-radius: 14.5px;
          color: #fff;
          display: flex;
          font-family: ${appFont};
          height: ${STAGE_H}px;
          left: 0;
          overflow: hidden;
          position: absolute;
          top: 0;
          width: ${STAGE_W}px;
        }
        /* The frame edge, lit from the top and a little to the left. A 1px
           gradient ring drawn with the masked padding-box recipe -- the same
           one EmailTurboInbox uses for .turbo-frame -- because a real CSS
           border cannot carry a gradient and keep its rounding, and
           border-image drops the radius entirely.

           160deg puts the bright end at the top tipped slightly left: CSS
           angles run clockwise from "to top", so the gradient travels down
           and a little right, and 0% therefore sits up and a little left.
           0.58 at the lit end is about where the old flat #818181 sat once
           composited, so the top edge holds its weight while everything
           away from the light gives way. */
        .cpg-rim {
          background: linear-gradient(
            160deg,
            rgb(232 232 232 / 0.58) 0%,
            rgb(232 232 232 / 0.34) 24%,
            rgb(232 232 232 / 0.15) 58%,
            rgb(232 232 232 / 0.1) 100%
          );
          border-radius: inherit;
          inset: 0;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          padding: 1px;
          pointer-events: none;
          position: absolute;
          z-index: 5;
        }
        /* Rail. Clips its own overflow, so narrowing it is what cuts the rows
           trailing content -- no second mechanism for the same motion. */
        .cpg-rail {
          background: #060709;
          border-radius: 14px 0 0 14px;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          height: 100%;
          overflow: hidden;
        }
        /* The header has two layouts, not one that stretches: wide enough
           and it is a tab row with a real search field, narrow and it
           collapses to a dropdown and two icon buttons -- which is what the
           two frames show, and what a container query would do in the app.
           Both are pinned to the width they were designed at and absolutely
           stacked, so neither reflows on the way past; the rail clips them. */
        .cpg-railhead { flex-shrink: 0; position: relative; }
        .cpg-headvar {
          align-items: center;
          display: flex;
          height: 100%;
          justify-content: space-between;
          left: 0;
          position: absolute;
          top: 0;
        }
        .cpg-headvar-wide {
          border-bottom: 0.5px solid #353535;
          padding: 0 8px 0 16px;
          width: ${STAGE_W}px;
        }
        .cpg-headvar-narrow { padding: 0 8px 0 16px; width: ${RAIL_W}px; }
        .cpg-title { font-size: 10px; font-weight: 600; white-space: nowrap; }
        /* Inset tab row -- the same shell as the narrow dropdown, carrying
           three tabs instead of one value and a caret. */
        .cpg-tabrow {
          align-items: flex-start;
          background: #000;
          border: 0.5px solid #1f1f1f;
          border-radius: 7px;
          display: flex;
          gap: 4px;
          padding: 2.5px;
        }
        /* Same padding as .cpg-seg-on, so the tab row and the dropdown it
           becomes are the same height and sit on the same baseline. */
        .cpg-insettab {
          border-radius: 5px;
          color: #8b8b8b;
          font-size: 10px;
          font-weight: 500;
          padding: 2px 6px 3px;
          white-space: nowrap;
        }
        .cpg-insettab-on { background: #16191f; border: 0.5px solid #353535; color: #fff; }
        .cpg-searchbar {
          align-items: center;
          background: #000;
          border: 0.5px solid #1f1f1f;
          border-radius: 7px;
          display: flex;
          flex-shrink: 0;
          height: 24px;
          justify-content: space-between;
          padding: 3px 8.5px;
          width: 164px;
        }
        .cpg-searchph { color: #8b8b8b; font-size: 10px; }
        .cpg-kbd { color: #8b8b8b; font-size: 9px; letter-spacing: 0.04em; }
        .cpg-seg {
          align-items: center;
          background: #000;
          border: 0.5px solid #1f1f1f;
          border-radius: 7px;
          display: flex;
          gap: 6px;
          padding: 2.5px 6px 2.5px 2.5px;
        }
        .cpg-seg-on {
          background: #16191f;
          border: 0.5px solid #1f1f1f;
          border-radius: 5px;
          font-size: 10px;
          padding: 2px 6px 3px;
          white-space: nowrap;
        }
        /* 22x22 around a 10px glyph -- the design's numbers. The icons are
           Figma's own exports at stroke-width 0.75, not the heavier phosphor
           set the rest of the repo uses, so the padding has something thin to
           sit around.

           The compose glyph is deliberately set smaller than its neighbours
           (8.5 against 10) rather than equal. Its export carries almost no
           internal padding -- ink fills 96% of its viewBox, where search
           fills 81% -- so at equal box sizes it drew 30% more ink and read
           noticeably bigger. 8.5 puts the two glyphs' ink within a tenth of
           a pixel of each other, which is what the eye is comparing. */
        .cpg-btn {
          align-items: center;
          background: #16191f;
          border: 0.5px solid #1f1f1f;
          border-radius: 7px;
          display: flex;
          flex-shrink: 0;
          height: 22px;
          justify-content: center;
          width: 22px;
        }
        .cpg-tools {
          align-items: center;
          display: flex;
          gap: 8px;
          flex-shrink: 0;
          padding: 8px 8px 4px 16px;
        }
        .cpg-pill {
          align-items: center;
          background: #16191f;
          border: 0.5px solid #1f1f1f;
          border-radius: 3px;
          color: #bfbfbf;
          display: flex;
          font-size: 10px;
          gap: 4px;
          padding: 2px 4px;
          white-space: nowrap;
        }
        .cpg-list { display: flex; flex-direction: column; padding: 0 8px 0 12px; }
        .cpg-row {
          align-items: center;
          border-radius: 7px;
          display: flex;
          gap: 10px;
          justify-content: space-between;
          overflow: hidden;
          padding: 5px 6px;
        }
        /* The selected row. Figma washes it with white at 10%, which over the
           #060709 rail composites to about #1f2022 -- pale enough that it read
           as the brightest thing in the list. #16191f is darker, and it is the
           surface token the artwork already uses for every raised element in
           here (the pills, the buttons, the composer), so the row now sits on
           the same step as the rest rather than above it. */
        .cpg-row-on { background: #16191f; }
        .cpg-rowleft { align-items: center; display: flex; flex-shrink: 0; padding-left: 7px; }
        /* The name group is a fixed 136 so the rail's edge lands in the same
           place relative to it at every width. */
        .cpg-namegroup { align-items: center; display: flex; gap: 7px; width: 136px; }
        .cpg-dot { background: #ff8f00; border-radius: 999px; flex-shrink: 0; height: 4px; width: 4px; }
        .cpg-name { font-size: 10px; font-weight: 600; white-space: nowrap; }
        .cpg-trail {
          align-items: center;
          display: flex;
          flex: 1 0 0;
          gap: 8px;
          min-width: 0;
          overflow: hidden;
        }
        .cpg-sender { color: #fff; flex-shrink: 0; font-size: 10px; font-weight: 500; }
        .cpg-preview {
          color: #8b8b8b;
          flex: 1 0 0;
          font-size: 10px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cpg-time { color: #8b8b8b; flex-shrink: 0; font-size: 10px; white-space: nowrap; }
        .cpg-face { border-radius: 999px; flex-shrink: 0; object-fit: cover; }
        .cpg-initials {
          align-items: center;
          background: #292b2f;
          border-radius: 999px;
          color: #bfbfbf;
          display: flex;
          flex-shrink: 0;
          justify-content: center;
        }
        /* Pane. The shell is whatever width the rail leaves, but the content
           inside it is pinned to the full open width and clipped -- so the
           pane is REVEALED as the rail narrows rather than reflowed into it.
           Letting it reflow meant every line of the thread rewrapped through
           the transition, which read as churn rather than a pane opening. */
        .cpg-pane {
          background: #0d0e11;
          border-left: 0.5px solid #1f1f1f;
          display: flex;
          flex: 1 0 0;
          height: 100%;
          min-width: 0;
          overflow: hidden;
        }
        .cpg-paneinner {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          height: 100%;
          width: ${STAGE_W - RAIL_W}px;
        }
        /* Figma hangs a drop shadow off this bar. Carried over as
           filter: drop-shadow it traced each CHILD instead -- the title, the
           tabs and the call button each got their own hard shadow -- because
           the container is transparent and drop-shadow follows the alpha it
           is given. It needs to be an opaque bar casting one shadow: hence
           the pane's own background, box-shadow, and a layer above the
           messages it is casting onto. */
        .cpg-panehead {
          align-items: center;
          background: #0d0e11;
          box-shadow: 0 6px 10px -6px rgb(0 0 0 / 0.55);
          display: flex;
          flex-shrink: 0;
          justify-content: space-between;
          padding: 8px 8px 8px 16px;
          position: relative;
          width: 100%;
          z-index: 1;
        }
        .cpg-tabs {
          align-items: flex-start;
          background: #000;
          border: 0.5px solid #1f1f1f;
          border-radius: 7px;
          display: flex;
          gap: 4px;
          padding: 2.5px;
        }
        .cpg-tab { border-radius: 5px; color: #8b8b8b; font-size: 10px; font-weight: 500; padding: 2px 6px 3px; white-space: nowrap; }
        .cpg-tab-on { background: #16191f; border: 0.5px solid #1f1f1f; color: #fff; }
        .cpg-msgs {
          display: flex;
          flex: 1 0 0;
          flex-direction: column;
          gap: 16px;
          justify-content: flex-end;
          min-height: 0;
          overflow: hidden;
          padding: 4px 72px 16px;
        }
        .cpg-msg { display: flex; gap: 10px; padding: 1px 6px; position: relative; width: 100%; }
        /* 38, not 32. The design nests these as a 32px indent on the reply
           GROUP plus the 6px each message row already carries, and collapsing
           that into one 32 dropped the 6 -- which is why the replies sat left
           of the collapsed-replies pill instead of sharing its edge. Both are
           38 now, and the thread elbow's foot is drawn for exactly that: the
           asset spans from the parent avatar's centre line to this edge. */
        .cpg-msg-reply { padding-left: 38px; }
        /* The thread line: one elbow per threaded item, dropping from the
           parent message and curving in behind the reply's avatar.
           
           The asset draws its vertical stroke at x=0.25 of its own 20.75 box,
           so the box sits at 17.75 to put that stroke on 18 -- the centre of
           a top-level avatar, which is at the row's 6px padding plus half of
           24. That is the whole constraint: the drop has to fall through the
           middle of the avatar it descends from. The 78px height is the
           asset's, hung by -65 so its foot lands on the target avatar's
           centre line. Clipped by .cpg-msgs at the top, as the frame is. */
        .cpg-elbow {
          height: 78px;
          left: 17.75px;
          pointer-events: none;
          position: absolute;
          top: -65px;
          width: 20.75px;
        }
        /* Above the elbow, so the line tucks behind rather than crossing it.
           An absolutely positioned element paints over static siblings
           whatever the DOM order, so each thing the elbow runs under has to
           be positioned itself -- the chip included, since the elbow's last
           9px land on top of it. */
        .cpg-face, .cpg-initials, .cpg-thread { position: relative; }
        .cpg-threadrow { padding-left: 38px; position: relative; width: 100%; }
        .cpg-msgbody { display: flex; flex: 1 0 0; flex-direction: column; gap: 4px; min-width: 0; }
        .cpg-msghead { display: flex; font-size: 10px; justify-content: space-between; padding-bottom: 2px; width: 100%; }
        .cpg-who { font-weight: 600; }
        .cpg-msgtext { color: #fff; font-size: 10px; line-height: 1.45; margin: 0; }
        .cpg-mention {
          background: rgb(255 143 0 / 0.2);
          border-radius: 2px;
          color: #ff8f00;
          font-weight: 500;
          padding: 1px 2px;
        }
        .cpg-thread {
          align-items: center;
          background: #16191f;
          border: 0.5px solid #353535;
          /* 6px, as drawn. It was a 999px pill, which rounded the ends off
             the only rectangle in the thread. */
          border-radius: 6px;
          color: #bfbfbf;
          display: flex;
          font-size: 10px;
          gap: 10px;
          padding: 4px 9px;
          width: fit-content;
        }
        .cpg-stack { display: flex; }
        .cpg-stack > * { border: 1px solid #16191f; margin-right: -4px; }
        .cpg-stack > :last-child { margin-right: 0; }
        /* The inline task mention: the type glyph, the title, then the
           task's own status, priority and assignee — the row reads as a
           reference to a real task rather than a link. Only the title is
           underlined; the underline used to sit on the whole row and dragged
           a rule under the trailing icons too. */
        .cpg-task { align-items: center; color: #fff; display: flex; font-size: 10px; gap: 2px; }
        /* Thinner and closer than the house max(1px, 0.06em) / 2px, which at
           10px resolves to a full pixel sitting clear of the type.

           The offset is what makes it break: skip-ink defaults to auto, but
           it can only cut around a descender the rule meaningfully crosses.
           Inter's p and y tails reach 2.08px below the baseline at this
           size, so a rule starting at 2px overlapped them by 0.08px -- real
           contact, but far too little to open a visible gap, and it read as
           drawing straight through. Starting at 1px puts a full pixel of the
           rule inside the tails and the gaps appear on their own. */
        .cpg-tasktitle {
          text-decoration: underline;
          text-decoration-skip-ink: auto;
          text-decoration-thickness: 0.5px;
          text-underline-offset: 1px;
        }
        /* 8px glyph in a 12px slot, as drawn, so it sits off the title by the
           same amount the other two do. */
        .cpg-taskstatus { align-items: center; display: flex; height: 12px; justify-content: center; width: 12px; }
        /* The design's numbers, which had been standing in as invented ones.
           The right and bottom padding are both 4 there -- the send button
           sits in the corner, so anything else shows as a mismatch around it,
           and 9/5 was reading as exactly that. */
        .cpg-composer {
          background: #0d0e10;
          border: 0.5px solid #353535;
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          gap: 4px;
          margin: 0 72px 12px;
          padding: 8px 4px 4px 6px;
        }
        .cpg-composer-ph { color: #8b8b8b; font-size: 10px; }
        .cpg-composer-row { align-items: center; display: flex; justify-content: space-between; }
        /* Padding around the glyph rather than a fixed box, which is how the
           design builds it: 4 around a 14px arrow. */
        .cpg-send {
          align-items: center;
          background: rgb(191 191 191 / 0.2);
          border-radius: 6px;
          display: flex;
          justify-content: center;
          padding: 4px;
        }
        /* Gated the way the docs figure gates its own callouts: below this
           there is no room beside the stage for a label, and the stage itself
           is already too small to annotate. */
        @media (min-width: 1000px) {
          .cpg-fig:not(.cpg-still) { aspect-ratio: ${STAGE_W} / ${FIG_H}; }
          .cpg-fig:not(.cpg-still) .cpg-frame { top: ${FRAME_TOP_PCT.toFixed(4)}%; }
          .cpg-fig:not(.cpg-still) .cpg-leads,
          .cpg-fig:not(.cpg-still) .cpg-note { display: block; }
        }
      `}</style>

      <div
        class="cpg-frame"
        ref={frameEl}
        aria-hidden="true"
        style={{ 'aspect-ratio': `${STAGE_W} / ${STAGE_H}` }}
      >
        <div class="cpg cpg-fade" style={{ zoom: scale() }}>
          {/* Rail — the channel list. Its width is the whole animation. */}
          <div class="cpg-rail" style={{ width: `${railW().toFixed(2)}px` }}>
            <div
              class="cpg-railhead"
              style={{
                height: `${HEAD_H}px`,
                width: `${railW().toFixed(2)}px`,
              }}
            >
              {/* Wide: tabs + a real search field. */}
              <div
                class="cpg-headvar cpg-headvar-wide"
                style={{ opacity: wideHead() }}
              >
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '16px',
                  }}
                >
                  <span class="cpg-title">Channels</span>
                  <div class="cpg-tabrow">
                    <span class="cpg-insettab cpg-insettab-on">Recent</span>
                    <span class="cpg-insettab">People</span>
                    <span class="cpg-insettab">Teams</span>
                  </div>
                </div>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '16px',
                  }}
                >
                  {/* The compact square in both layouts. The wide frame draws
                    this as a 24px pill, but one shape that does not change
                    with the header is steadier than two that do. */}
                  <div class="cpg-btn">
                    <Ic icon={IconCompose} size={8.5} />
                  </div>
                  <div class="cpg-searchbar">
                    <div
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '6px',
                      }}
                    >
                      <Ic icon={IconSearch} size={10} />
                      <span class="cpg-searchph">Search</span>
                    </div>
                    <span class="cpg-kbd">⌘ F</span>
                  </div>
                </div>
              </div>
              {/* Narrow: the tab row becomes a dropdown, the field a button. */}
              <div
                class="cpg-headvar cpg-headvar-narrow"
                style={{ opacity: narrowHead() }}
              >
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <span class="cpg-title">Channels</span>
                  <div class="cpg-seg">
                    <span class="cpg-seg-on">Recent</span>
                    <Ic icon={IconCaretDown} size={10} opacity={0.7} />
                  </div>
                </div>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <div class="cpg-btn">
                    <Ic icon={IconCompose} size={8.5} />
                  </div>
                  <div class="cpg-btn">
                    <Ic icon={IconSearch} size={10} />
                  </div>
                </div>
              </div>
            </div>

            <div class="cpg-tools" style={{ width: `${railW().toFixed(2)}px` }}>
              <span class="cpg-pill">
                <Ic icon={IconSortAscending} size={12} />
                Sort
              </span>
              {/* The control the scene is acting out. It swaps glyph rather
                than colour, which is what the two frames do: an eye while the
                pane is closed (show it), an eye-slash while it is open (hide
                it). A hard swap at the ramp's midpoint, since a real button
                changes on the click rather than easing across it. */}
              <span class="cpg-pill">
                <Ic icon={split() < 0.5 ? IconEye : IconEyeSlash} size={11} />
                Preview
              </span>
            </div>

            <div class="cpg-list" style={{ width: `${railW().toFixed(2)}px` }}>
              <For each={ROWS}>
                {(row) => (
                  <div class={`cpg-row${row.active ? ' cpg-row-on' : ''}`}>
                    <div class="cpg-rowleft">
                      <div class="cpg-namegroup">
                        <Show
                          when={row.unread}
                          fallback={<div style={{ width: '4px' }} />}
                        >
                          {/* Opacity, not presence: the dot keeps its 4px so
                            the name beside it never shifts. */}
                          <div
                            class="cpg-dot"
                            style={{
                              opacity: row.active ? unreadOpacity() : undefined,
                            }}
                          />
                        </Show>
                        <Show
                          when={row.avatar || row.initials}
                          fallback={
                            <div style={{ padding: '0 2px' }}>
                              <Ic icon={IconHash} size={11} />
                            </div>
                          }
                        >
                          <Avatar
                            src={row.avatar}
                            initials={row.initials}
                            size={14}
                            font={6}
                          />
                        </Show>
                        <span class="cpg-name">{row.name}</span>
                      </div>
                    </div>
                    <div class="cpg-trail" style={{ opacity: trailOpacity() }}>
                      <span class="cpg-sender">{row.sender}</span>
                      <span class="cpg-preview">{row.message}</span>
                      <span class="cpg-time">{row.time}</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Pane — only ever seen at the open end of the ramp. */}
          <div class="cpg-pane" style={{ opacity: paneOpacity() }}>
            <div class="cpg-paneinner">
              <div class="cpg-panehead">
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '4px',
                    }}
                  >
                    <Ic icon={IconHash} size={11} />
                    <span class="cpg-title">{PREVIEWED}</span>
                  </div>
                  <div class="cpg-tabs">
                    <span class="cpg-tab cpg-tab-on">Messages</span>
                    <span class="cpg-tab">Attachments</span>
                    <span class="cpg-tab">Participants</span>
                  </div>
                </div>
                <div class="cpg-btn">
                  <Ic icon={IconCall} size={10} />
                </div>
              </div>

              <div class="cpg-msgs">
                <For each={MESSAGES}>
                  {(m, i) => (
                    <>
                      <div class={`cpg-msg${m.reply ? ' cpg-msg-reply' : ''}`}>
                        <Show when={m.reply}>
                          <ThreadElbow class="cpg-elbow" aria-hidden="true" />
                        </Show>
                        <Avatar
                          src={m.avatar}
                          initials={m.initials}
                          size={24}
                          font={8}
                        />
                        <div class="cpg-msgbody">
                          <div class="cpg-msghead">
                            <span class="cpg-who">{m.who}</span>
                            <span class="cpg-time">{m.time}</span>
                          </div>
                          <p class="cpg-msgtext">{m.text}</p>
                          <Show when={i() === 3}>
                            <span class="cpg-task">
                              <Ic icon={IconTaskGlyph} size={12} />
                              <span class="cpg-tasktitle">
                                Support snippet OR type filter
                              </span>
                              <span class="cpg-taskstatus">
                                <Ic icon={IconTaskStatus} size={8} />
                              </span>
                              <Ic icon={IconTaskPriority} size={10} />
                              <img
                                src={avatarJacob}
                                alt=""
                                class="cpg-face"
                                style={{ height: '10px', width: '10px' }}
                              />
                            </span>
                          </Show>
                        </div>
                      </div>
                      {/* The collapsed thread sits under the last reply. */}
                      <Show when={i() === 2}>
                        <div class="cpg-threadrow">
                          <ThreadElbow class="cpg-elbow" aria-hidden="true" />
                          <div class="cpg-thread">
                            <div class="cpg-stack">
                              <Avatar src={avatarGabriel} size={18} font={6} />
                              <Avatar initials="RA" size={18} font={6} />
                              <Avatar src={avatarJacob} size={18} font={6} />
                            </div>
                            12 more replies • last reply Thursday
                          </div>
                        </div>
                      </Show>
                    </>
                  )}
                </For>
              </div>

              <div class="cpg-composer">
                <span class="cpg-composer-ph">
                  Type @ to share with #{PREVIEWED}
                </span>
                <div class="cpg-composer-row">
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '8px',
                      padding: '0 2px',
                    }}
                  >
                    <Ic icon={IconPaperclip} size={12} />
                    <Ic icon={IconTextAa} size={12} />
                  </div>
                  <div class="cpg-send">
                    <Ic icon={IconArrowUp} size={14} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <span aria-hidden="true" class="cpg-rim" />
        </div>
        <span aria-hidden="true" class="cpg-keylight" />
      </div>

      {/* Leaders and dots. pathLength normalises every path to 100 so one
          dashoffset draws them all at the same rate regardless of length. */}
      <svg
        class="cpg-leads"
        viewBox={`0 ${-NOTE_ZONE_TOP} ${STAGE_W} ${FIG_H}`}
        aria-hidden="true"
        style={{
          '--cpg-lead-ink': `color-mix(in oklab, var(--cpg-lead-dim), var(--c4) ${(notesLit() * 100).toFixed(1)}%)`,
        }}
      >
        <For each={NOTES}>
          {(n) => (
            <>
              <path
                class="cpg-lead"
                pathLength="100"
                stroke-dasharray="100"
                stroke-dashoffset={100 * (1 - notesIn())}
                d={n.pts
                  .map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`)
                  .join('')}
              />
              <circle
                class="cpg-leaddot"
                cx={n.pts[0][0]}
                cy={n.pts[0][1]}
                r={2.6 * notesIn()}
              />
            </>
          )}
        </For>
      </svg>

      <For each={NOTES}>
        {(n) => (
          <p
            class="cpg-note"
            style={{
              [n.at === 'top' ? 'bottom' : 'top']:
                `${noteEdgePct(n).toFixed(4)}%`,
              /* Mixed in oklab rather than srgb: both ends are oklch tokens
                 and the ramp is pure lightness, so this keeps it even. */
              color: `color-mix(in oklab, var(--c4), var(--c2) ${(notesLit() * 100).toFixed(1)}%)`,
              left: `${((n.labelX / STAGE_W) * 100).toFixed(4)}%`,
              opacity: notesIn(),
            }}
          >
            {n.label}
          </p>
        )}
      </For>
    </div>
  );
}
