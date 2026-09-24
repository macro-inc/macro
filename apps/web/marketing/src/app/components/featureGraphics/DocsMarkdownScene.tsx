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
  untrack,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconChannel from '../../../assets/icons/icon-channels.svg';
import IconEmail from '../../../assets/icons/icon-email.svg';
import IconTask from '../../../assets/icons/icon-tasks.svg';
import IconArrowUp from '../../../assets/icons/phosphor/arrow-up.svg';
import IconChatTeardrop from '../../../assets/icons/phosphor/chat-teardrop.svg';
import IconClock from '../../../assets/icons/phosphor/clock.svg';
import IconLink from '../../../assets/icons/phosphor/link.svg';
import IconPalette from '../../../assets/icons/phosphor/palette.svg';
import IconShare from '../../../assets/icons/phosphor/share.svg';
import IconTextAa from '../../../assets/icons/phosphor/text-aa.svg';
import IconX from '../../../assets/icons/phosphor/x.svg';
import IconStatusInProgress from '../../../assets/icons/square-task-in-progress-circle.svg';
import IconDoc from '../../../assets/icons/wide-file-md.svg';
import IconPriorityMedium from '../../../assets/icons/wide-priority-medium.svg';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJacob from '../../../assets/people/jacob-work.webp';
import avatarJulia from '../../../assets/people/julia.webp';
import { createVisible } from '../../utils/utilVisible';

// ---------------------------------------------------------------------------
// "Markdown example" — the docs page's markdown demo, as live DOM.
//
// This is the /documents demo recording -- public/video/docs-markdown-demo.mp4,
// deleted once this scene replaced it, so pull it from git history to compare --
// rebuilt as a scene: a document types itself, markdown resolves into real
// blocks as the syntax lands, and one @ opens a search over the whole
// workspace that comes back as a person, a task, a date, an email and a
// channel. It closes on the Figma frame the design was drawn to -- file
// IOH8EtjS7V8rmxnbJzFZ2A, node 1040:5374 -- with "Agenda" highlighted and
// carrying a comment.
//
// Mechanism, borrowed wholesale from the tasks page's lifecycle scene
// (sections/TasksLifecycleScene.tsx + TasksLifecycle.tsx): everything on
// screen is a pure function of the clock `t`, milliseconds into CYCLE. There
// are no timers, tweens or transitions of state inside the scene -- only
// ramps read off `t` -- which is what lets it seek, hold and prerender a
// sensible frame without any of that machinery knowing. DocsMarkdownGraphic
// owns the one rAF that advances `t`, and only while the frame is on screen.
//
// The one thing the clock does not drive is the caret blink, which is a CSS
// keyframe: a caret's phase should follow the wall clock rather than restart
// every time the loop wraps.
//
// Geometry is fluid rather than a zoomed artboard. The tasks scene pins a
// Figma export to a fixed stage because its numbers had to survive verbatim;
// this panel is live text that has to stay legible from 320px up. So the
// Figma's proportions are kept as ratios instead: one stated type size, and
// every measure inside in em off it -- which is what lets the whole document
// be re-scaled by one number, and lets a phone drop it a point and let the
// lines wrap. The card is capped at the width that size wants; the frame
// around it keeps the page's full column and the difference is wash.
// ---------------------------------------------------------------------------

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Entity hues. Figma paints each linked object type its own colour -- task
// green, email coral, channel periwinkle -- and none of those has a token,
// because the site's accent ramp (--a0..--a4) is five fixed hues at one
// lightness and chroma. So they are taken off --a0 at Figma's hue instead,
// which keeps them at the accent's weight and lets them follow the theme.
// The same trick ChannelsGraphics.tsx:49 uses for its violet note colour.
/**
 * The two bounces in the corners of the stage frame. The warm one is the
 * tasks page's (TasksLifecycle.tsx:348-361): the midpoint of the brand orange
 * and the neutral key light, which in OKLCH is a move along chroma alone
 * because --c1 is --a0's own hue at zero chroma -- so it reads as the same
 * light going warm rather than as a second colour.
 *
 * The cool one cannot be built the same way. --a4 is at 204deg and --c1 at
 * 44, so mixing them interpolates the hue through 124 and comes out green.
 * So the mix is taken for its lightness and chroma only and the hue is
 * pinned past the end of the site's ramp, where it reads as blue rather than
 * as the cyan --a4 already is.
 */
const GLOW_WARM = 'color-mix(in oklch, var(--a0), var(--c1))';
const GLOW_COOL =
  'oklch(from color-mix(in oklch, var(--a4), var(--c1)) l c 240deg)';

const HUE_DOC = 'oklch(from var(--a0) l c 293deg)';
const HUE_TASK = 'oklch(from var(--a0) l c 145deg)';
const HUE_EMAIL = 'oklch(from var(--a0) l c 32deg)';
const HUE_CHANNEL = 'oklch(from var(--a0) l c 275deg)';

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

type ChipKind = 'person' | 'task' | 'date' | 'email' | 'channel';

/**
 * One row of the @ palette. A person is drawn as a face where the repo has
 * one for them and as their initial where it does not -- a teammate's
 * photograph next to somebody else's name is worse than no photograph.
 * Precedence: avatar, then initials, then the kind's glyph.
 */
type MenuRow = {
  icon?: ChipKind | 'doc' | 'snippet';
  avatar?: string;
  initials?: string;
  label: string;
  detail?: string;
  active?: boolean;
};
type MenuSection = { title: string; count: number; rows: MenuRow[] };

type Seg =
  /** Plain characters. */
  | { k: 'text'; text: string }
  /**
   * A trigger character that opens a menu, optionally takes a query, and
   * resolves into whatever was picked.
   *
   * `trigger` is @ for the workspace search and ; for snippets -- the two
   * keys this editor gives you, and the reason the calendar link arrives
   * whole rather than being typed out: it is a saved fragment, inserted by
   * name. `insert` says what lands: a chip for an object, a link for a
   * snippet whose body is a URL.
   *
   * `above` opens the menu over the line rather than under it, which is what
   * an editor does for a line near the bottom of its viewport -- and what
   * lets this panel be cropped there instead of holding half its height in
   * reserve for a menu that only two lines ever need.
   */
  | {
      k: 'at';
      trigger?: string;
      kind?: ChipKind;
      insert?: 'link';
      query: string;
      label: string;
      wide: MenuSection[];
      narrow: MenuSection[];
      above?: boolean;
    };

type Block = {
  kind: 'p' | 'h2' | 'li' | 'todo';
  /**
   * The markdown that turns a paragraph into this block, typed as literal
   * characters and then swallowed by the block it just made. Empty on a row
   * the editor continued for you -- the second bullet, the second checkbox --
   * which is why those get their marker from the first keystroke instead.
   */
  md: string;
  segs: Seg[];
};

const CAL_LINK = 'https://cal.com/jacob-beckerman-b56mrn/30min';

/** What a bare @ offers before it has been narrowed: one row from every kind
    of thing in the workspace. This is the whole argument of the graphic, so
    the first mention is the one that gets to show it. */
const MENU_EVERYTHING: MenuSection[] = [
  {
    title: 'People',
    count: 11842,
    rows: [
      { initials: 'E', label: 'Evan', detail: 'evan@macro.com', active: true },
    ],
  },
  {
    title: 'Documents, Agents, & Tasks',
    count: 10199,
    rows: [{ icon: 'doc', label: 'Q3 launch plan' }],
  },
  {
    title: 'Channels',
    count: 134,
    rows: [{ icon: 'channel', label: 'launch' }],
  },
  {
    title: 'Emails',
    count: 10,
    rows: [{ icon: 'email', label: 'Today: Thursday’s launch' }],
  },
  { title: 'Dates', count: 5, rows: [{ icon: 'date', label: 'Friday' }] },
];

/**
 * What ; offers: saved fragments, inserted by name. The calendar link in the
 * recording arrives this way rather than being typed -- which is the point,
 * because a forty-three character URL is exactly the thing nobody types
 * twice.
 */
const SNIPPETS: MenuSection[] = [
  {
    title: 'Snippets',
    count: 12,
    rows: [
      { icon: 'snippet', label: 'Dog image snippet' },
      { icon: 'snippet', label: 'Jacob Calendar', active: true },
    ],
  },
];

const DOC_TITLE = 'Q3 launch plan';

const SCRIPT: Block[] = [
  {
    kind: 'p',
    md: '',
    segs: [
      { k: 'text', text: 'Launch owner: ' },
      {
        k: 'at',
        kind: 'person',
        query: 'ev',
        label: '@evan',
        wide: MENU_EVERYTHING,
        narrow: [
          {
            title: 'People',
            count: 3,
            rows: [
              {
                initials: 'E',
                label: 'Evan',
                detail: 'evan@macro.com',
                active: true,
              },
              {
                avatar: avatarGabriel,
                label: 'Gabriel Birman',
                detail: 'gab@macro.com',
              },
            ],
          },
        ],
      },
      { k: 'text', text: '.' },
    ],
  },
  {
    kind: 'p',
    md: '',
    segs: [
      { k: 'text', text: 'Before launch, finish ' },
      {
        k: 'at',
        kind: 'task',
        query: 'prep',
        label: 'Prepare the launch checklist',
        wide: [
          {
            title: 'People',
            count: 3,
            rows: [
              {
                avatar: avatarJulia,
                label: 'Julia Westphal',
                detail: 'julia@macro.com',
              },
            ],
          },
          {
            title: 'Documents, Agents, & Tasks',
            count: 74,
            rows: [
              { icon: 'doc', label: 'Q3 launch notes' },
              {
                icon: 'task',
                label: 'Prepare the launch checklist',
                active: true,
              },
            ],
          },
        ],
        narrow: [
          {
            title: 'Documents, Agents, & Tasks',
            count: 2,
            rows: [
              {
                icon: 'task',
                label: 'Prepare the launch checklist',
                active: true,
              },
              { icon: 'doc', label: 'Launch checklist — spec' },
            ],
          },
        ],
      },
      { k: 'text', text: '.' },
    ],
  },
  {
    kind: 'p',
    md: '',
    segs: [
      { k: 'text', text: 'Team check-in: ' },
      {
        k: 'at',
        trigger: ';',
        insert: 'link',
        query: '',
        label: CAL_LINK,
        wide: SNIPPETS,
        narrow: SNIPPETS,
      },
    ],
  },
  {
    kind: 'p',
    md: '',
    segs: [
      { k: 'text', text: 'Launch date: ' },
      {
        k: 'at',
        kind: 'date',
        query: 'fri',
        label: 'Friday',
        wide: [
          {
            title: 'Emails',
            count: 10,
            rows: [{ icon: 'email', label: 'Today: Thursday’s launch' }],
          },
          {
            title: 'Dates',
            count: 5,
            rows: [
              { icon: 'date', label: 'Today' },
              { icon: 'date', label: 'Friday', active: true },
            ],
          },
        ],
        narrow: [
          {
            title: 'Dates',
            count: 2,
            rows: [
              { icon: 'date', label: 'Friday', active: true },
              { icon: 'date', label: 'Friday, 9:00 AM' },
            ],
          },
        ],
      },
    ],
  },
  { kind: 'h2', md: '## ', segs: [{ k: 'text', text: 'Launch checklist' }] },
  {
    kind: 'li',
    md: '- ',
    segs: [{ k: 'text', text: 'Confirm the invite flow' }],
  },
  {
    kind: 'li',
    md: '',
    segs: [{ k: 'text', text: 'Share the plan with Dana' }],
  },
  { kind: 'h2', md: '## ', segs: [{ k: 'text', text: 'Context' }] },
  {
    kind: 'todo',
    md: '[] ',
    segs: [
      { k: 'text', text: 'Read the launch email: ' },
      {
        k: 'at',
        kind: 'email',
        query: 'thur',
        above: true,
        label: 'Thursday’s launch',
        wide: [
          {
            title: 'Documents, Agents, & Tasks',
            count: 6,
            rows: [{ icon: 'doc', label: 'Launch schedule' }],
          },
          {
            title: 'Emails',
            count: 4,
            rows: [{ icon: 'email', label: 'Thursday’s launch', active: true }],
          },
        ],
        narrow: [
          {
            title: 'Emails',
            count: 4,
            rows: [
              { icon: 'email', label: 'Thursday’s launch', active: true },
              { icon: 'email', label: 'Re: Thursday’s launch — numbers' },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: 'todo',
    md: '',
    segs: [
      { k: 'text', text: 'Post any updates to ' },
      {
        k: 'at',
        kind: 'channel',
        query: 'laun',
        above: true,
        label: 'launch',
        wide: [
          {
            title: 'People',
            count: 2,
            rows: [
              {
                avatar: avatarGabriel,
                label: 'Gabriel Birman',
                detail: 'gab@macro.com',
              },
            ],
          },
          {
            title: 'Channels',
            count: 3,
            rows: [{ icon: 'channel', label: 'launch', active: true }],
          },
        ],
        narrow: [
          {
            title: 'Channels',
            count: 3,
            rows: [
              { icon: 'channel', label: 'launch', active: true },
              { icon: 'channel', label: 'launch leads' },
            ],
          },
        ],
      },
    ],
  },
];

/** The run the comment lands on, and the comment itself. */
const COMMENT_TEXT = 'Please check the date against Dana’s email.';
/** Which block carries the highlight and the badge -- the "Agenda" heading. */
const COMMENT_BLOCK = 4;

// ---------------------------------------------------------------------------
// The timeline, built rather than named
//
// The tasks scene names every beat by hand because it has about thirty of
// them. This document has ten blocks, five mentions and roughly two hundred
// and forty keystrokes, so the beats are generated from the script above by
// one pass that hands out absolute timestamps. Same properties as a hand
// written table -- pure, deterministic, and as cheap to seek into as to play
// through -- without three hundred lines of constants that could drift from
// the copy they time.
// ---------------------------------------------------------------------------

/** Base dwell per character of body text. */
const CHAR_MS = 32;
/** A search query is typed slower -- the typist is watching the list move. */
const QUERY_CHAR_MS = 74;
/**
 * Markdown is the one thing this graphic is arguing about, so the three
 * keystrokes that make a block get their own, slower pace: typed deliberately
 * rather than at prose speed, held once complete so the syntax can be read as
 * syntax, and then a beat on the empty block it turned into before anything
 * is written in it. At body speed the whole transformation happened inside
 * four frames and read as a glitch.
 */
const MD_CHAR_MS = 78;
/** How long the finished token stands before the block swallows it. */
const MD_SNAP_MS = 420;
/** And how long the block it made stands empty before the words arrive. */
const MD_SETTLE_MS = 240;

/** After the @ lands, before the palette is up. */
const AT_OPEN_MS = 240;
/**
 * How long the bare @ stands before the query starts narrowing it. Scaled by
 * how much the palette is offering, because that is how long it takes to
 * read: the first mention opens on all five kinds of thing in the workspace
 * and is the whole argument of the graphic, so it gets about a second; the
 * later ones open two sections and get about half of that.
 */
const AT_BROWSE_MS = 420;
const AT_BROWSE_PER_SECTION_MS = 130;
/** The palette stands on its highlighted row before Enter takes it. */
const PICK_HOLD_MS = 560;
/** Palette out, chip in. */
const RESOLVE_MS = 260;
/** Between two rows of the same list. */
const ROW_PAUSE_MS = 240;
/** Between blocks that are not list rows. */
const BLOCK_PAUSE_MS = 420;
/** Before the first keystroke. */
const LEAD_IN_MS = 700;

/**
 * Per-character stamps for one run of text. A flat cadence reads as a machine;
 * deterministic jitter, a longer beat on a space and a longer one still after
 * a full stop read as a person. Deterministic so the table is the same on the
 * server, on the client, and on every wrap of the loop.
 */
function stampChars(text: string, from: number, per: number): number[] {
  const out: number[] = [];
  let acc = from;
  for (let i = 0; i < text.length; i++) {
    let d = per + (((i * 7919) % 11) - 5) * (per * 0.055);
    if (text[i] === ' ') d += per * 0.85;
    if (i > 0 && text[i - 1] === '.') d += per * 5;
    acc += d;
    out.push(acc);
  }
  return out;
}

type PlanSeg = {
  seg: Seg;
  /** Per-character stamps of whatever this segment types: the run, the URL, or the query. */
  at: number[];
  /** When the @ itself lands. */
  atSign: number;
  /** Palette fully up. */
  open: number;
  /** Enter. */
  pick: number;
  /** Chip fully resolved -- also the moment the link finishes linkifying. */
  done: number;
  /**
   * A short run of punctuation directly after a mention, drawn by the chip
   * instead of in its own place in the line. The chip's trailing glyph group
   * is an atomic inline and so offers a wrap after itself; at a 320px column
   * that put a lone full stop on a line of its own.
   */
  glued: boolean;
};

type PlanBlock = {
  block: Block;
  /** First keystroke of the block. */
  start: number;
  /** Stamps of the markdown token's own characters. */
  mdAt: number[];
  /** The token collapses and the block takes its real shape. */
  snap: number;
  segs: PlanSeg[];
  /** Last ink of the block. */
  end: number;
};

const PLAN: PlanBlock[] = (() => {
  const out: PlanBlock[] = [];
  let now = LEAD_IN_MS;
  SCRIPT.forEach((block, bi) => {
    const start = now;
    const mdAt = stampChars(block.md, now, MD_CHAR_MS);
    now = mdAt.length ? mdAt[mdAt.length - 1] : now;
    const snap = now + (block.md ? MD_SNAP_MS : 0);
    now = snap + (block.md ? MD_SETTLE_MS : 0);

    const segs: PlanSeg[] = block.segs.map((seg, si) => {
      const after = block.segs[si - 1];
      const glued =
        seg.k === 'text' && seg.text.length <= 2 && !!after && after.k === 'at';
      if (seg.k === 'at') {
        const atSign = now + CHAR_MS;
        const open = atSign + AT_OPEN_MS;
        const browse =
          open + AT_BROWSE_MS + AT_BROWSE_PER_SECTION_MS * seg.wide.length;
        const at = stampChars(seg.query, browse, QUERY_CHAR_MS);
        // A menu opened without a query -- the snippet list -- still stands
        // long enough to be read before the pick.
        const pick = (at.length ? at[at.length - 1] : browse) + PICK_HOLD_MS;
        const done = pick + RESOLVE_MS;
        now = done;
        return { seg, at, atSign, open, pick, done, glued };
      }
      const at = stampChars(seg.text, now, CHAR_MS);
      const done = at.length ? at[at.length - 1] : now;
      now = done;
      return { seg, at, atSign: 0, open: 0, pick: 0, done, glued };
    });

    const end = now;
    const next = SCRIPT[bi + 1];
    const sameList =
      next && next.md === '' && (next.kind === 'li' || next.kind === 'todo');
    now = end + (sameList ? ROW_PAUSE_MS : BLOCK_PAUSE_MS);
    out.push({ block, start, mdAt, snap, segs, end });
  });
  return out;
})();

const TYPED_END = PLAN[PLAN.length - 1].end;

// --- the closing act: select the heading, comment on it ---------------------
// The one beat with a pointer in it. Everything up to here is a keyboard, and
// a keyboard needs no hand on screen; a selection that appeared on its own
// would read as a rendering fault rather than as somebody doing something.
const TL = {
  /** The pointer comes in from the lower right and lands at the heading's left edge. */
  pointerIn: [TYPED_END + 460, TYPED_END + 1120] as const,
  /**
   * Press, drag across "Agenda", release. 700ms rather than the 500 it
   * started at: the highlight steps a character at a time, and six characters
   * in 500ms spends about two frames on each, which reads as a sweep that
   * happens to be jagged rather than as a selection being pulled.
   */
  drag: [TYPED_END + 1220, TYPED_END + 1920] as const,
  /** The format bar rises under the selection. */
  barIn: [TYPED_END + 1980, TYPED_END + 2180] as const,
  /** Over to the comment button. */
  toComment: [TYPED_END + 2260, TYPED_END + 2760] as const,
  commentClick: TYPED_END + 2860,
  /** Bar out, composer in. */
  barOut: [TYPED_END + 2860, TYPED_END + 3040] as const,
  composerIn: [TYPED_END + 2960, TYPED_END + 3200] as const,
  /** The comment is typed, then sent. */
  commentType: [TYPED_END + 3280, TYPED_END + 4540] as const,
  send: TYPED_END + 4860,
  composerOut: [TYPED_END + 4860, TYPED_END + 5080] as const,
  /** The heading keeps the highlight and picks up its badge. */
  markIn: [TYPED_END + 4920, TYPED_END + 5240] as const,
  /** The pointer leaves the way it came. */
  pointerOut: [TYPED_END + 5080, TYPED_END + 5680] as const,
  /**
   * How it starts over. Two and a half seconds on the finished document,
   * then select all -- one keystroke, so the wash lands on every line at
   * once rather than sweeping -- a beat with the whole thing lit, and the
   * delete that empties it. The panel is then exactly what it is at t=0, an
   * empty document with a caret in it, so the wrap needs no crossfade to
   * hide a jump: there is no jump. The title stays, the way a title stays
   * when you select the body of a document and clear it.
   */
  selectAll: [TYPED_END + 7800, TYPED_END + 7960] as const,
  wipe: TYPED_END + 8460,
} as const;

export const CYCLE = TL.wipe + 900;

/**
 * The frame the server paints and the frame reduced motion holds on: the
 * finished document, comment and all. Every word of the copy is in the static
 * HTML that way, which is what a crawler and a reader with motion turned off
 * both want -- and it is the frame the Figma was drawn as.
 */
export const REST_T = TL.selectAll[0] - 900;

/** Stamps for the comment, timed to its own beat rather than the body's. */
const COMMENT_STAMPS = stampChars(
  COMMENT_TEXT,
  TL.commentType[0],
  (TL.commentType[1] - TL.commentType[0]) / COMMENT_TEXT.length
);

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const _lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** How many stamps in a table have landed. */
const countAt = (stamps: number[], now: number) => {
  let n = 0;
  while (n < stamps.length && stamps[n] <= now) n++;
  return n;
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * The repo's icon assets carry width="100%" height="100%" and, on the ones
 * whose strokes run to the edge of the viewBox, overflow="visible". They are
 * therefore sized from the outside, never with width/height attributes.
 */
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
      height: `${p.h ?? p.w}em`,
      overflow: 'visible',
      width: `${p.w}em`,
      ...p.style,
    }}
  />
);

const CHIP_ICON: Record<ChipKind | 'doc', Component<any>> = {
  person: IconDoc, // unused: a person is drawn as an avatar, never a glyph
  doc: IconDoc,
  task: IconTask,
  date: IconClock,
  email: IconEmail,
  channel: IconChannel,
};

/**
 * Inter's cap height as a fraction of the em. A glyph set beside a line of
 * type reads as level with it when its box centres on the middle of the
 * capitals -- not on the baseline the type sits on, and not on the middle of
 * the em box, which includes descender space the capitals never use.
 */
const CAP_HEIGHT = 0.727;
/** The vertical-align that centres a box of height h on that midline. */
const centreOn = (h: number) => `${(CAP_HEIGHT / 2 - h / 2).toFixed(4)}em`;

/** The clock is a filled glyph and carries its own optical padding; the
    entity icons are line art drawn to their box, so they run a touch larger
    to match its weight on the line. */
const CHIP_ICON_EM: Record<ChipKind | 'doc', number> = {
  person: 1.07,
  doc: 1.07,
  task: 1.07,
  date: 1,
  email: 1.07,
  channel: 1.07,
};

const CHIP_COLOR: Record<ChipKind | 'doc', string> = {
  person: 'var(--a0)',
  doc: HUE_DOC,
  task: HUE_TASK,
  date: 'var(--a0)',
  email: HUE_EMAIL,
  channel: HUE_CHANNEL,
};

/**
 * A person is an accent pill; everything else is a small coloured glyph and an
 * underlined title, which is how the product draws the difference between
 * somebody you are addressing and something you are pointing at. A task
 * trails its status, priority and owner as bare glyphs -- at this size a
 * labelled pill would be three quarters of the line and would say what the
 * glyph already says.
 */
function Chip(props: { kind: ChipKind; label: string; tail?: string }) {
  return (
    <Show
      when={props.kind !== 'person'}
      fallback={
        <span
          class="mds-chip-person"
          style={{
            'background-color':
              'color-mix(in srgb, var(--a0) 20%, transparent)',
            'border-radius': '0.22em',
            color: 'var(--a0)',
            'font-weight': '500',
            padding: '0.1em 0.14em',
            'white-space': 'nowrap',
          }}
        >
          {props.label}
        </span>
      }
    >
      {/* A date wears the same tint a person does: Figma paints one behind
          both, because both are a resolved object standing in a sentence
          rather than a thing the sentence is pointing at. */}
      <span
        class="mds-chip"
        style={
          props.kind === 'date'
            ? {
                'background-color':
                  'color-mix(in srgb, var(--a0) 20%, transparent)',
                'border-radius': '0.22em',
                padding: '0.1em 0.16em',
              }
            : undefined
        }
      >
        {/* Aligned off its own height rather than a shared constant: the
            clock is drawn at 1em and the entity glyphs at 1.07, so one
            offset for both left the clock sitting low against "Friday". */}
        <Ic
          icon={CHIP_ICON[props.kind]}
          w={CHIP_ICON_EM[props.kind]}
          color={CHIP_COLOR[props.kind]}
          style={{
            display: 'inline-block',
            'margin-right': '0.2em',
            'vertical-align': centreOn(CHIP_ICON_EM[props.kind]),
          }}
        />
        <Show
          when={props.kind !== 'date'}
          fallback={<span style={{ color: 'var(--a0)' }}>{props.label}</span>}
        >
          <span class="mds-u">{props.label}</span>
        </Show>
        <Show when={props.kind === 'task'}>
          {/* Status, priority, owner -- the trailing glyphs a task mention
              carries in the product. */}
          <span class="mds-taskmeta">
            <Ic icon={IconStatusInProgress} w={0.78} color="var(--a0)" />
            <Ic icon={IconPriorityMedium} w={1.0} h={0.67} color="var(--c2)" />
            <img
              alt=""
              class="mds-avatar"
              src={avatarJacob}
              style={{ height: '0.9em', width: '0.9em' }}
            />
            {/* The sentence's full stop rides inside the glyph group rather
                than following it. The group is an atomic inline, so a wrap is
                allowed after it -- which at a 320px column left the full stop
                alone on a line of its own. */}
            {props.tail}
          </span>
        </Show>
        <Show when={props.kind !== 'task'}>{props.tail}</Show>
      </span>
    </Show>
  );
}

/**
 * A menu row's glyph takes the entity's colour, except a date: in a document
 * a date resolves to an object and is drawn as one, but in the list it is a
 * value among values and reads better in the row's own ink.
 */
const MENU_ICON_COLOR: Record<ChipKind | 'doc', string> = {
  ...CHIP_COLOR,
  date: 'var(--c1)',
};

/** Whatever leads a palette row: a face, an initial, or the kind's glyph. */
function RowGlyph(props: { row: MenuRow }) {
  /** The snippet glyph is drawn by the branch below, so by the time this is
      read the icon is one of the kinds that has an asset. */
  const kind = (): ChipKind | 'doc' => {
    const icon = props.row.icon;
    return icon && icon !== 'snippet' ? icon : 'doc';
  };
  return (
    <Show
      when={props.row.icon !== 'snippet'}
      fallback={
        // Three characters rather than a drawing, because that is what the
        // product sets there: braces round an equals, in the violet a
        // document wears.
        <span aria-hidden="true" class="mds-snip">
          {'{=}'}
        </span>
      }
    >
      <Show
        when={props.row.avatar}
        fallback={
          <Show
            when={props.row.initials}
            fallback={
              <Ic
                icon={CHIP_ICON[kind()]}
                w={1.05}
                color={MENU_ICON_COLOR[kind()]}
              />
            }
          >
            {(text) => (
              <span aria-hidden="true" class="mds-initials">
                {text()}
              </span>
            )}
          </Show>
        }
      >
        {(src) => <img alt="" class="mds-avatar mds-rowface" src={src()} />}
      </Show>
    </Show>
  );
}

/** A row of the @ palette. */
function PaletteRow(props: { row: MenuRow }) {
  return (
    <span
      class="mds-prow"
      style={{
        'background-color': props.row.active
          ? 'color-mix(in srgb, var(--c1) 5%, transparent)'
          : 'transparent',
      }}
    >
      <RowGlyph row={props.row} />
      <span class="mds-prow-label">{props.row.label}</span>
      <Show when={props.row.detail}>
        <span class="mds-prow-detail">{props.row.detail}</span>
      </Show>
    </span>
  );
}

/**
 * The @ palette: one search across people, documents, agents, tasks, channels,
 * emails and dates, sectioned by kind with a count of everything it did not
 * have room for. Lifted from the real typeahead the way RealMentionMenu
 * (DocumentsGraphics.tsx:1182) draws it -- section header on the left, "View
 * all (n)" on the right, one highlighted row.
 */
function Palette(props: {
  sections: MenuSection[];
  amount: number;
  above?: boolean;
}) {
  return (
    <span
      class={`mds-palette${props.above ? ' up' : ''}`}
      style={{
        opacity: props.amount.toFixed(3),
        // Match MentionsMenu's fade/scale entrance, driven by the demo clock
        // so pausing or seeking also holds the menu's transition.
        transform: `translateY(${((1 - props.amount) * (props.above ? 2 : -2)).toFixed(3)}px) scale(${(0.96 + props.amount * 0.04).toFixed(4)})`,
        'transform-origin': props.above ? 'bottom center' : 'top center',
        visibility: props.amount > 0.004 ? 'visible' : 'hidden',
      }}
    >
      <For each={props.sections}>
        {(section, i) => (
          <>
            <Show when={i() > 0}>
              <span class="mds-pdiv" />
            </Show>
            <span class="mds-phead">
              <span>{section.title}</span>
              <Show when={section.count > section.rows.length}>
                <span>View all ({section.count})</span>
              </Show>
            </span>
            <For each={section.rows}>{(row) => <PaletteRow row={row} />}</For>
          </>
        )}
      </For>
    </span>
  );
}

/** The product's own pointer, the same path the tasks scene draws. */
const CURSOR_VB = { w: 9.014, h: 9.012 };
const CURSOR_PATH =
  'M3.902 8.546L5.012 5.511L5.512 5.011L8.547 3.902L8.562 3.896C8.7 3.834 8.817 3.733 8.896 3.604C8.976 3.475 9.014 3.326 9.007 3.175C9 3.024 8.947 2.878 8.856 2.758C8.765 2.637 8.639 2.547 8.496 2.499L0.992 0.049C0.861 0.006 0.72 0 0.586 0.032C0.452 0.064 0.329 0.133 0.231 0.231C0.133 0.328 0.065 0.451 0.032 0.585C0 0.72 0.006 0.86 0.049 0.992L2.499 8.496C2.545 8.64 2.635 8.768 2.756 8.86C2.877 8.952 3.023 9.005 3.175 9.011H3.211C3.357 9.012 3.5 8.969 3.621 8.889C3.743 8.809 3.839 8.695 3.896 8.562L3.902 8.546Z';

/**
 * Drawn at 0.7em rather than the 0.95 it started at. The path is the
 * product's own cursor and is not ours to redraw, so slimming it means
 * drawing it smaller -- which also puts it back at the absolute size an OS
 * cursor is, around 14px once the panel's type has settled at 20.
 */
const CURSOR_EM = 0.7;
/** Where the point actually lands, as a fraction of the box. Not (0, 0): the
    tip is a rounded corner whose curve turns at 0.231, and the press below
    pivots on the point, not on the corner of its bounding box. */
const CURSOR_TIP = 0.231 / CURSOR_VB.w;
const CURSOR_ORIGIN = `${(CURSOR_EM * CURSOR_TIP).toFixed(4)}em`;

/**
 * The I-beam. Not the product's cursor -- it is the platform's, and every
 * platform draws the same one: two serifs and a stem. Hand-drawn because
 * there is no asset for it and nothing to be faithful to but the shape
 * itself. Its hot point is its centre, not a corner, which is why it is
 * offset by half of itself rather than by the arrow's tip fraction.
 */
const BEAM_W = 0.38;
const BEAM_H = 0.98;
const BEAM_PATH = 'M1.4 1.4H6.6V2.4H4.5V13.6H6.6V14.6H1.4V13.6H3.5V2.4H1.4Z';

export const DocsDemoPointer = (p: { text?: boolean }) => (
  <Show
    when={p.text}
    fallback={
      <svg
        viewBox={`0 0 ${CURSOR_VB.w} ${CURSOR_VB.h}`}
        aria-hidden="true"
        style={{
          display: 'block',
          height: `${CURSOR_EM}em`,
          overflow: 'visible',
          width: `${CURSOR_EM}em`,
        }}
      >
        <path d={CURSOR_PATH} fill="var(--c0)" />
      </svg>
    }
  >
    <svg
      viewBox="0 0 8 16"
      aria-hidden="true"
      style={{
        display: 'block',
        height: `${BEAM_H}em`,
        overflow: 'visible',
        // Half of itself, in its own terms. A negative margin would do the
        // same arithmetic against the wrong box.
        transform: 'translate(-50%, -50%)',
        width: `${BEAM_W}em`,
      }}
    >
      <path d={BEAM_PATH} fill="var(--c0)" />
    </svg>
  </Show>
);

/**
 * Where the pointer is, in the heading's own box: a percentage of its width
 * plus an offset. Expressing it that way is what keeps the closing act free of
 * measurement -- the selection, the format bar and the hand all live inside
 * the run being selected, so they follow it through every reflow the panel can
 * be put through.
 */
// --- how a hand moves -------------------------------------------------------
// Lifted from the tasks scene (TasksLifecycleScene.tsx:487-556), which is
// where the reasoning for each piece is written out. The only change is the
// unit: those constants are stage units on an 880-wide artboard, and these
// are em of the panel's own type, so every threshold and cap is divided by
// about 20 -- the px an em is worth at the size the panel settles on.

/** Deterministic per-move variation, so no two crossings share a rhythm and
    every replay is still identical. */
const vary = (i: number, n: number) => {
  const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Smooth deterministic wobble in roughly [-1, 1]. Hands do not travel on a
    ruled line, and they do not hold perfectly still between corrections
    either -- which is the most obviously synthetic part of a pointer that has
    otherwise been given a nice easing curve. */
const wobble = (u: number, i: number, axis: number) => {
  const p = vary(i, 10 + axis) * 6.283;
  return 0.62 * Math.sin(u * 5.3 + p) + 0.38 * Math.sin(u * 11.7 + p * 1.7);
};

/** Under this, a move is one confident motion: a hand only throws and
    corrects when the distance is long enough to be worth a ballistic swing,
    and applying the same profile to every move is most of what makes
    synthetic cursors read as synthetic. */
const BALLISTIC_MIN = 3.9;
const overshoot = (len: number, i: number) => {
  if (len <= BALLISTIC_MIN) return 0;
  const ramp = Math.min(1, (len - BALLISTIC_MIN) / 2.9);
  return ramp * (0.7 + 0.6 * vary(i, 0)) * Math.min(0.05, 0.25 / len);
};

/** One fast ballistic throw that carries past the mark, a pause while the eye
    checks it, then one or two small corrective hops onto the target -- the
    submovements Fitts's law describes. At o = 0 it collapses to a single
    smooth motion, which is what short hops and drags get. */
const travel = (k: number, o: number, i: number): number => {
  if (o <= 0) return ease(k);
  const kb = 0.54 + 0.12 * vary(i, 1);
  const twoHops = vary(i, 2) > 0.45;
  if (k <= kb) return (1 + o) * (1 - Math.pow(1 - clamp01(k / kb), 3));
  const rest = 1 - kb;
  const back = -(0.2 + 0.35 * vary(i, 4));
  const h1 = 0.2 + 0.14 * vary(i, 5);
  const h2 = 0.54 + 0.14 * vary(i, 6);
  const h3 = 0.74 + 0.1 * vary(i, 7);
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

/**
 * The paint scale the page is drawn at. getBoundingClientRect reports the
 * transformed box while getComputedStyle reports the layout one, and
 * html { zoom: var(--site-scale) } is 1.1 above 1280px and 1.2 above 1920 --
 * so a range measured off a rect has to be divided back. Walked up from the
 * run because the run is an inline span, and getComputedStyle reports
 * width:auto for those. Same helper, same reason, as
 * DocumentsGraphics.tsx:1540.
 */
function visualScale(from: HTMLElement) {
  for (let el: HTMLElement | null = from; el; el = el.parentElement) {
    const layout = parseFloat(getComputedStyle(el).width);
    if (layout > 0) return el.getBoundingClientRect().width / layout;
  }
  return 1;
}

/** Where the pointer sits, in em, measured from the selected run's left edge
    and its bottom. */
type Spot = { x: number; y: number };
/**
 * Where the comment button's centre is, in the format bar's own em -- which
 * is the same em everything else in the closing act uses, because one type
 * size drives the panel. Derived from the bar's metrics rather than stated:
 * as a hand-totalled 9.79 it was a fifth of an em short, and the pointer sat
 * off the button it was about to press.
 */
const BAR_PAD_X = 0.43;
const BAR_BTN = 1.86;
const BAR_GAP = 0.29;
const BAR_COMMENT_X = BAR_PAD_X + 4 * (BAR_BTN + BAR_GAP) + BAR_BTN / 2;
/** Off the run to its lower right, which is where the hand comes from and
    goes back to. Both are relative to the run's own width. */
const SPOT_OFF = (run: number): Spot => ({ x: run + 6.9, y: 4.4 });
/** On the run's middle, not below it: an I-beam straddles the line it is
    over. `h` is the run's measured height. */
const SPOT_SEL_A = (h: number): Spot => ({ x: 0.07, y: -h / 2 });
const SPOT_SEL_B = (run: number, h: number): Spot => ({
  x: run + 0.07,
  y: -h / 2,
});
const SPOT_COMMENT: Spot = { x: BAR_COMMENT_X, y: 1.93 };
/** The run the pointer selects, for the measurement guard below. */
const COMMENT_RUN_TEXT = SCRIPT[COMMENT_BLOCK].segs
  .map((seg) => (seg.k === 'at' ? seg.label : seg.text))
  .join('');
/** Stand-ins until the run has been measured -- "Agenda" at 600 weight, in
    a line box of its own type. */
const RUN_EM_FALLBACK = 4.3;
const RUN_H_FALLBACK = 1.2;

const BAR_TOOLS: { icon: Component<any>; label: string }[] = [
  { icon: IconPalette, label: 'Highlight' },
  { icon: IconTextAa, label: 'Format' },
  { icon: IconLink, label: 'Link' },
  { icon: IconDoc, label: 'Turn into' },
  { icon: IconChatTeardrop, label: 'Comment' },
  { icon: IconShare, label: 'Share' },
];

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function DocsMarkdownScene(props: { t: Accessor<number> }) {
  const t = props.t;
  const P = (a: number, b: number) => clamp01((t() - a) / (b - a));
  const E = (r: readonly [number, number]) => ease(P(r[0], r[1]));

  /** The block the caret is in -- the last one that has started. */
  const writing = createMemo(() => {
    if (t() > TYPED_END) return -1;
    let i = -1;
    for (let k = 0; k < PLAN.length; k++) if (t() >= PLAN[k].start) i = k;
    return i;
  });

  const barAmt = () => clamp01(E(TL.barIn) - E(TL.barOut));
  const composerAmt = () => clamp01(E(TL.composerIn) - E(TL.composerOut));
  const markAmt = () => E(TL.markIn);
  const pointerAmt = () => clamp01(E(TL.pointerIn) - E(TL.pointerOut));

  // --- the run being selected, measured -------------------------------------
  // A selection lands on character boundaries or it is not a selection: drawn
  // as a fraction of the run it cuts an edge through the middle of an "m" as
  // readily as beside it, which is exactly what gives a fake one away. So the
  // boundaries are measured with a Range over the run's text node, in em, and
  // the highlight snaps to the last one the hand has passed.
  let runEl: HTMLSpanElement | undefined;
  let sceneEl: HTMLDivElement | undefined;
  const [stops, setStops] = createSignal<number[]>([]);
  const [runH, setRunH] = createSignal(RUN_H_FALLBACK);
  const runEm = () => {
    const s = stops();
    return s.length > 1 ? s[s.length - 1] : RUN_EM_FALLBACK;
  };

  const measure = () => {
    const host = runEl;
    const node = host?.firstChild;
    // Only once the run is whole: a Range over a half-typed line would pin
    // the boundaries to the wrong glyphs, and a detached node has no box.
    if (
      !host ||
      !node ||
      node.nodeType !== 3 ||
      node.textContent !== COMMENT_RUN_TEXT
    )
      return setStops([]);
    const box = host.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(host).fontSize);
    if (!box.width || !(size > 0)) return setStops([]);
    const scale = visualScale(host) || 1;
    setRunH(box.height / scale / size);
    const range = document.createRange();
    const out: number[] = [];
    for (let i = 0; i <= COMMENT_RUN_TEXT.length; i++) {
      range.setStart(node, 0);
      range.setEnd(node, i);
      out.push((range.getBoundingClientRect().right - box.left) / scale / size);
    }
    // A collapsed range at offset 0 has no rect of its own in some engines,
    // so the first stop can come back as the host's right edge. Pin it.
    out[0] = 0;
    setStops(out);
  };

  // Measured on an edge, never on t(): an effect that reads the clock would
  // run a Range over the DOM sixty times a second. Re-measured whenever the
  // panel is resized, because the type size is a fraction of its width.
  const typedOut = createMemo(() => t() >= TYPED_END);
  createEffect(
    on(typedOut, (done) => {
      if (done) queueMicrotask(measure);
    })
  );
  onMount(() => {
    if (typeof ResizeObserver !== 'undefined' && sceneEl) {
      const ro = new ResizeObserver(() => measure());
      ro.observe(sceneEl);
      onCleanup(() => ro.disconnect());
    }
    void document.fonts?.ready.then(measure);
  });

  // --- the hand -------------------------------------------------------------
  /** Off the run, to the start of the run, across it, to the comment button,
      away. The drag is flagged: a hand pulling a selection is not throwing at
      a target, so it neither overshoots nor bows much. */
  const legs = () => {
    const r = runEm();
    const h = runH();
    const a = SPOT_SEL_A(h);
    const b = SPOT_SEL_B(r, h);
    return [
      { from: SPOT_OFF(r), to: a, span: TL.pointerIn, drag: false },
      { from: a, to: b, span: TL.drag, drag: true },
      { from: b, to: SPOT_COMMENT, span: TL.toComment, drag: false },
      { from: SPOT_COMMENT, to: SPOT_OFF(r), span: TL.pointerOut, drag: false },
    ];
  };

  const cursor = createMemo((): Spot => {
    const now = t();
    const i =
      now >= TL.pointerOut[0]
        ? 3
        : now >= TL.toComment[0]
          ? 2
          : now >= TL.drag[0]
            ? 1
            : 0;
    const leg = legs()[i];
    const dx = leg.to.x - leg.from.x;
    const dy = leg.to.y - leg.from.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = P(leg.span[0], leg.span[1]);
    // A throw gets the ballistic profile; a drag gets a curve half way
    // between that ease and a straight line, because an ease-in-out spends
    // most of its motion in the middle and the characters there went past in
    // a frame each while the two at either end sat still.
    const d = leg.drag
      ? 0.5 * k + 0.5 * ease(k)
      : travel(k, overshoot(len, i), i);
    // A drag is steadier than a throw -- the button is down and the eye is on
    // the text -- so it keeps a little of the noise and none of the arc.
    const steady = leg.drag ? 0.3 : 1;
    // A lateral bow, so the path is an arc rather than a ruled line.
    const bow =
      Math.min(len * 0.09, 0.6) *
      (vary(i, 3) * 2 - 1) *
      Math.sin(Math.PI * clamp01(d)) *
      steady;
    // Wobble tapers to nothing as the move ends, so the pointer still lands
    // exactly on its mark -- everything else here is noise, this one bit is
    // not allowed to be.
    const amp = Math.min(len * 0.05, 0.28) * (1 - k) * steady;
    return {
      x: leg.from.x + dx * d - (dy / len) * bow + wobble(k, i, 0) * amp,
      y: leg.from.y + dy * d + (dx / len) * bow + wobble(k, i, 1) * amp,
    };
  });

  /**
   * Which cursor to draw. Not a phase of the timeline but a fact about where
   * the pointer is: a cursor over text is an I-beam, and it becomes one as it
   * crosses onto the run and an arrow again as it leaves for the format bar,
   * which is what the platform does and what the eye is expecting.
   */
  const overText = createMemo(() => {
    const p = cursor();
    return (
      p.x > -0.5 && p.x < runEm() + 0.5 && p.y > -runH() - 0.2 && p.y < 0.2
    );
  });

  /** How much of the run is selected, in em: the last character boundary the
      hand has passed. Falls back to a plain sweep before the run has been
      measured, which is only ever the first frames of a cold cycle. */
  const selEm = createMemo(() => {
    const now = t();
    if (now < TL.drag[0]) return 0;
    if (now >= TL.drag[1]) return runEm();
    const s = stops();
    if (s.length < 2) return E(TL.drag) * runEm();
    const x = cursor().x;
    let w = 0;
    for (const stop of s) if (stop <= x) w = stop;
    return w;
  });

  /** The press that opens the comment, as a ring that expands and fades. */
  const clickAmt = () => clamp01((t() - TL.commentClick) / 420);
  /** The pointer dips into the click and comes back out of it. */
  const pressing = () =>
    clickAmt() > 0 && clickAmt() < 1 ? Math.sin(clickAmt() * Math.PI) : 0;

  const commentChars = createMemo(() => countAt(COMMENT_STAMPS, t()));

  /** Everything is selected, then gone. */
  const selAllAmt = () => (t() >= TL.wipe ? 0 : E(TL.selectAll));
  /** True while the document is empty: before the first keystroke, and again
      after the delete. The same frame either side of the wrap. */
  const blank = () => t() < PLAN[0].start || t() >= TL.wipe;

  return (
    <div ref={sceneEl} class="mds">
      <style>{`
        /*
         * One type size drives the panel and every measure inside it is in
         * em off that -- so the whole document is re-scaled by changing this
         * one number, and nothing inside has to know.
         *
         * It is stated rather than derived from the card's width. Scaling it
         * to fill the page column put the body at 20px, which is a document
         * drawn at a size no document is read at; at 14 it is the size the
         * page's other editor mocks use and the size the thing it is a
         * picture of actually runs at. The frame keeps the page's full width
         * and the difference goes to wash at the sides.
         */
        .mds {
          box-sizing: border-box;
          color: var(--c1);
          font-family: ${appFont};
          /* Held in custom properties as well as applied, because the
             composer lives inside the heading it comments on and would
             otherwise inherit that heading's 1.2em and its 600 -- and a
             comment is body copy, whatever it happens to be attached to. */
          --mds-body: 14px;
          --mds-body-weight: 350;
          font-size: var(--mds-body);
          /*
           * 350, not Inter's 400. Figma specifies Regular, but Figma draws
           * this document at 10px and it is set here at twice that, on a
           * near-black ground -- and light type on a dark one blooms, so the
           * same weight that reads as body copy small reads as half a step
           * bold large. The variable face is loaded across 100..900
           * (index.css:27-32) so this is a real cut, not a synthesised one.
           * Everything with a weight of its own -- the title, the headings,
           * the chips, the menu rows -- is untouched.
           */
          font-weight: var(--mds-body-weight);
          height: 100%;
          /*
           * The other half of the weight problem, and the bigger half.
           * Without this, WebKit subpixel-antialiases the panel's text, and
           * subpixel AA on light-over-dark thickens every stem -- which is
           * why the same Inter that looks right on the page's own copy looks
           * half a step bold in here. The real editor this is a picture of
           * sets it, as every desktop-class web app does; scoped to the
           * panel, so nothing else on the page changes rendering.
           */
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          line-height: 1.5;
          padding: 1.86em 2.86em 1.43em;
          position: relative;
          text-align: left;
        }
        .mds-title {
          font-size: 1.36em;
          font-weight: 600;
          letter-spacing: -0.01em;
          margin: 0 0 1.8em;
        }
        /* Figma sets a flat 12 units between blocks and 4 between the rows of
           one list; at this panel's 1.4x that is 17 and 6, less the extra
           leading a 1.5 line-height already adds over Figma's 1.2 boxes. */
        /* text-wrap: pretty for the orphan, not for the ragged edge: at a 320px
           column the task line broke with its closing full stop alone on the
           last line, which reads as a rendering fault rather than as a wrap. */
        .mds-line { margin: 0 0 0.86em; min-height: 1.5em; position: relative; text-wrap: pretty; }
        .mds-line.h2 { font-size: 1.2em; font-weight: 600; }
        .mds-line.row { display: flex; gap: 0.6em; }
        .mds-line.rowmid { margin-bottom: 0.36em; }
        /* The heading row carries its comment badge at the far end. */
        .mds-h2row { align-items: center; display: flex; gap: 0.86em; justify-content: space-between; }
        .mds-run { position: relative; }

        /* The palette hangs off the @ it belongs to, so it needs no measuring
           to follow the caret. On a phone the column is too narrow for that --
           an @ two thirds of the way along a line would push a 250px menu off
           the panel -- so the anchor goes static there and the menu resolves
           against the line instead, which is where a narrow editor puts it. */
        .mds-at { position: relative; }
        @media (max-width: 699px) { .mds-at { position: static; } }

        /* The trigger characters read as what they are: text somebody typed.
           Not accent-coloured and not set in mono -- either would say the
           editor had already understood them, and the whole point of the
           beat that follows is that it has not understood them yet. The
           preserved whitespace is load-bearing: it is the space after the
           "##" that makes the heading, so it has to be on screen, with the
           caret one place past it, before anything transforms. */
        .mds-md { color: inherit; white-space: pre; }
        .mds-u {
          text-decoration-color: color-mix(in srgb, var(--c1) 26%, transparent);
          text-decoration-line: underline;
          text-decoration-thickness: max(1px, 0.06em);
          text-underline-offset: 0.14em;
        }
        /* Deliberately breakable. A task title is a run of words, and at a
           320px column "Prepare the launch checklist" plus its three
           trailing glyphs is wider than the measure -- nowrap put it through
           the panel's right edge instead of wrapping it the way the editor
           would. Only the status/priority/owner group is held together. */
        .mds-taskmeta { align-items: center; display: inline-flex; gap: 0.22em; margin-left: 0.3em; vertical-align: -0.0865em; white-space: nowrap; }
        .mds-initials {
          align-items: center;
          background-color: var(--b3);
          border: 1px solid color-mix(in srgb, var(--c4) 10%, transparent);
          border-radius: 999px;
          box-sizing: border-box;
          color: var(--c1);
          display: inline-grid;
          flex: none;
          font-weight: 600;
          line-height: 1;
          place-items: center;
        }
        .mds-snip {
          color: ${HUE_DOC};
          flex: none;
          font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
          font-size: 0.86em;
          letter-spacing: -0.04em;
          line-height: 1;
        }
        /* What a snippet leaves in the line: the URL it holds, as a link. */
        .mds-link {
          color: var(--a0);
          text-decoration-color: color-mix(in srgb, var(--a0) 70%, transparent);
          text-decoration-line: underline;
          text-underline-offset: 0.14em;
        }
        .mds-avatar { border-radius: 999px; display: inline-block; flex: none; object-fit: cover; vertical-align: -0.14em; }
        .mds-rowface { height: 1.2em; width: 1.2em; }
        .mds-initials { font-size: 0.55em; height: 2.18em; width: 2.18em; }

        .mds-bullet { background-color: var(--c2); border-radius: 999px; flex: none; height: 0.29em; margin-left: 0.6em; margin-top: 0.62em; width: 0.29em; }
        .mds-box { border: 1px solid var(--b4); border-radius: 0.28em; box-sizing: border-box; flex: none; height: 1em; margin-left: 0.36em; margin-top: 0.25em; width: 1em; }

        /* 0.07em, which is about what a stem of Inter 350 measures at this size.
           It was 0.11 -- the ratio the repo's fixed 1.5px caret has against
           14px text -- and at twice that type it came out half again thicker
           than the letters it stood next to, which is what makes a caret read
           as a block rather than as an insertion point. The 1px floor is for
           the phone, where 0.07em rounds to nothing. */
        .mds-caret { background-color: var(--c1); display: inline-block; height: 1.05em; margin-left: 0.07em; vertical-align: -0.2em; width: max(1px, 0.07em); }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes mdsCaret { 0%, 52% { opacity: 1; } 53%, 100% { opacity: 0; } }
          .mds-caret { animation: mdsCaret 1.08s steps(1) infinite; }
        }

        .mds-palette {
          /* MentionsMenu's Surface depth=2 / bg-menu-glass and glass rim.
             Marketing routes use the b/c theme ramp without app utilities. */
          background-color: var(--color-menu-glass, color-mix(in oklch, var(--b2) 88%, transparent));
          border-radius: 0.72em;
          box-shadow:
            inset 0 1px 0 color-mix(in oklch, var(--c1) 6%, transparent),
            inset 0 -1px 0 color-mix(in oklch, var(--b0) 40%, transparent),
            0 14px 32px -22px rgb(0 0 0 / 0.55);
          box-sizing: border-box;
          display: block;
          left: 0;
          padding: 0.5em 0 0.4em;
          position: absolute;
          top: calc(100% + 0.5em);
          /* Wide enough for "Documents, Agents, & Tasks" and its count on one
             line -- that section header is the longest string the menu has
             and ellipsising it hides half of what the menu is claiming. */
          width: 21.5em;
          z-index: 6;
        }
        .mds-palette::after {
          background: linear-gradient(135deg,
            color-mix(in oklch, var(--c1) 13.5%, transparent) 0%,
            transparent 24%, transparent 76%,
            color-mix(in oklch, var(--c1) 9%, transparent) 100%);
          border-radius: inherit;
          content: '';
          inset: 0;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          padding: 1px;
          pointer-events: none;
          position: absolute;
        }
        /* Opened over the line instead of under it. Same rule an editor
           follows near the foot of a viewport, and here it is what keeps the
           two menus at the bottom of the document out of the crop. */
        .mds-palette.up { bottom: calc(100% + 0.5em); top: auto; }
        .mds-pdiv { background-color: color-mix(in srgb, var(--b4) 30%, transparent); display: block; height: 1px; margin: 0.34em 0; }
        .mds-phead {
          color: var(--c4);
          display: flex;
          font-size: 0.8em;
          font-weight: 500;
          gap: 0.8em;
          justify-content: space-between;
          line-height: 1.4;
          padding: 0 0.88em 0.3em;
          white-space: nowrap;
        }
        /* The kind, then how many more there are. On a narrow panel the kind
           gives way first -- the count is the shorter half and the half that
           carries the argument. */
        .mds-phead > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .mds-phead > span:last-child { flex: none; }
        .mds-prow { align-items: center; border-radius: 0.5em; display: flex; gap: 0.6em; margin: 0 0.42em; padding: 0.34em 0.5em; }
        .mds-prow-label { color: var(--c1); font-size: 0.92em; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mds-prow-detail { color: var(--c4); font-size: 0.86em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* The run under the selection, and the mark the comment leaves on it.
           Two layers rather than one: the drag paints a plain selection wash
           that sweeps to full width, and the comment mark fades in over it
           with the rule underneath, so the handover reads as the comment
           taking hold of the run rather than as one colour becoming another. */
        .mds-sel { background-color: color-mix(in srgb, var(--c1) 16%, transparent); bottom: -0.12em; left: -1px; position: absolute; right: auto; top: -0.06em; }
        /* The same wash, over the whole of every line rather than a measured
           run of one: select-all is a keystroke, so it does not sweep and it
           does not need character boundaries. */
        .mds-selall { background-color: color-mix(in srgb, var(--c1) 16%, transparent); bottom: -0.12em; left: -1px; position: absolute; right: -1px; top: -0.06em; }
        .mds-mark { background-color: color-mix(in srgb, var(--a0) 24%, transparent); border-bottom: max(1.5px, 0.11em) solid var(--a0); bottom: -0.12em; left: -1px; position: absolute; right: -1px; top: -0.06em; }
        .mds-runtext { position: relative; }

        .mds-bar {
          align-items: center;
          background-color: color-mix(in srgb, var(--b1) 78%, var(--b0));
          border-radius: 0.64em;
          /* The hairline as an inset shadow rather than a border: a border
             sits outside the padding box, which put every button 1px right
             of where the pointer's arithmetic expects it. */
          box-shadow: var(--shadow-panel-lg), inset 0 0 0 1px color-mix(in srgb, var(--c4) 18%, transparent);
          display: flex;
          gap: 0.29em;
          left: 0;
          padding: 0.21em 0.43em;
          position: absolute;
          top: calc(100% + 0.71em);
          z-index: 7;
        }
        /* Direct children only. Unscoped, this also caught the pulse ring
           inside a button and squared it off: .mds-bar span outranks
           .mds-ring, so the ring's own 999px radius lost. */
        .mds-bar > span { align-items: center; border-radius: 0.43em; display: inline-flex; height: 1.86em; justify-content: center; width: 1.86em; }
        .mds-bar > span.hot { background-color: color-mix(in srgb, var(--c1) 10%, transparent); }

        /* border-box, so the stroke grows inward. On content-box the ring's
           border box came out 0.22em bigger than the button holding it and,
           pinned to the top left, sat 2px down and right of the icon. */
        .mds-ring {
          border: max(1px, 0.11em) solid var(--a0);
          border-radius: 999px;
          box-sizing: border-box;
          height: 1.86em;
          left: 0;
          position: absolute;
          top: 0;
          width: 1.86em;
        }

        .mds-hand { left: 0; pointer-events: none; position: absolute; top: 0; z-index: 9; }

        .mds-composer {
          background-color: color-mix(in srgb, var(--b1) 82%, var(--b0));
          border: 1px solid color-mix(in srgb, var(--c4) 20%, transparent);
          border-radius: 0.72em;
          box-shadow: var(--shadow-panel-lg);
          box-sizing: border-box;
          font-size: var(--mds-body);
          font-weight: var(--mds-body-weight);
          padding: 0.64em 0.72em 0.5em;
          /*
           * A child of the commented line, not of the panel: top 0 puts its
           * head level with the run it is about -- which is where a comment
           * composer goes, and is the only thing that says which run it
           * belongs to -- and right 0 takes it to the far edge of the
           * document, where the thread rail lives. Both fall out of the
           * line's own box, so neither needs measuring.
           */
          position: absolute;
          right: 0;
          top: 0;
          width: 15em;
          z-index: 8;
        }
        .mds-composer-foot { display: flex; gap: 0.43em; justify-content: flex-end; margin-top: 0.57em; }
        .mds-composer-foot span { align-items: center; border-radius: 999px; display: inline-flex; height: 1.29em; justify-content: center; width: 1.29em; }

        .mds-badge {
          align-items: center;
          background-color: color-mix(in srgb, var(--a0) 20%, transparent);
          border-radius: 0.36em;
          display: inline-flex;
          flex: none;
          gap: 0.29em;
          padding: 0.07em 0.36em 0.07em 0.21em;
        }
        .mds-badge b { color: var(--c2); font-size: 0.62em; font-weight: 500; }

        @media (max-width: 699px) {
          .mds { --mds-body: 12.5px; padding: 1.44em 1.44em 1.12em; }
          /* Skip the text-sized inline anchors while a menu is open so its
             containing block is the full document line on small screens. */
          .mds-run:has(.mds-palette), .mds-runtext:has(.mds-palette) { position: static; }
          /* Anchored to the line rather than to the @ down here, so the
             measure the menu must fit inside is the line's. max-width rather
             than width, because the inline width is the desktop one and a
             stylesheet max-width still clamps it. */
          .mds-palette { max-width: 100%; }
          .mds-title { margin-bottom: 1.3em; }
          .mds-composer { width: 13em; }
        }
      `}</style>

      <h3 class="mds-title">{DOC_TITLE}</h3>

      {/* Before the first keystroke and after the delete: the same frame, on
          both sides of the wrap. */}
      <Show when={blank()}>
        <div class="mds-line">
          <span class="mds-caret" />
        </div>
      </Show>

      <For each={PLAN}>
        {(plan, bi) => {
          const shown = () => t() >= plan.start && t() < TL.wipe;
          const snapped = () => t() >= plan.snap;
          /** A row the editor continued for you wears its marker from the off. */
          const marker = () => (plan.block.md ? snapped() : shown());
          const isRow = plan.block.kind === 'li' || plan.block.kind === 'todo';
          /** A row with another row of the same list under it closes up; the
              last row of a list keeps the full between-blocks gap. */
          const next = SCRIPT[bi() + 1];
          const rowMid =
            isRow &&
            !!next &&
            next.md === '' &&
            (next.kind === 'li' || next.kind === 'todo');
          return (
            <Show when={shown()}>
              <div
                class={`mds-line${plan.block.kind === 'h2' && snapped() ? ' h2' : ''}${isRow ? ' row' : ''}${rowMid ? ' rowmid' : ''}`}
              >
                {/* At full size the instant the row exists. It used to grow in
                  over 200ms, which meant that for the first few frames after
                  a return the caret was sitting beside a six-pixel speck --
                  it read as the marker being late rather than as emphasis. */}
                <Show when={isRow && marker()}>
                  <span
                    class={plan.block.kind === 'li' ? 'mds-bullet' : 'mds-box'}
                  />
                </Show>
                <span
                  class={bi() === COMMENT_BLOCK ? 'mds-h2row' : undefined}
                  style={
                    bi() === COMMENT_BLOCK ? undefined : { display: 'block' }
                  }
                >
                  <span class="mds-run">
                    <Show when={selAllAmt() > 0.004}>
                      <span
                        class="mds-selall"
                        style={{ opacity: selAllAmt().toFixed(3) }}
                      />
                    </Show>
                    {/* The markdown token, for as long as it is still text. */}
                    <Show when={plan.block.md && !snapped()}>
                      <span class="mds-md">
                        {plan.block.md.slice(0, countAt(plan.mdAt, t()))}
                      </span>
                    </Show>
                    <Show
                      when={
                        bi() === COMMENT_BLOCK &&
                        (selEm() > 0 || markAmt() > 0.001)
                      }
                    >
                      <Show
                        when={markAmt() > 0.001}
                        fallback={
                          <span
                            class="mds-sel"
                            style={{
                              width: `calc(${selEm().toFixed(3)}em + 2px)`,
                            }}
                          />
                        }
                      >
                        <span
                          class="mds-mark"
                          style={{ opacity: markAmt().toFixed(3) }}
                        />
                      </Show>
                    </Show>
                    <span
                      class="mds-runtext"
                      ref={(el) => {
                        if (bi() === COMMENT_BLOCK) runEl = el;
                      }}
                    >
                      <For each={plan.segs}>
                        {(ps, si) => {
                          const seg = ps.seg;
                          // A glued run is drawn by the chip in front of it.
                          if (ps.glued) return null;
                          if (seg.k === 'text')
                            return (
                              <>{seg.text.slice(0, countAt(ps.at, t()))}</>
                            );
                          // A mention: the @ and its query, then the palette, then the chip.
                          const openAmt = () =>
                            clamp01(
                              ease(clamp01((t() - ps.atSign) / AT_OPEN_MS)) -
                                ease(clamp01((t() - ps.pick) / RESOLVE_MS))
                            );
                          const chipAmt = () =>
                            ease(clamp01((t() - ps.pick) / RESOLVE_MS));
                          const narrowed = () => countAt(ps.at, t()) > 0;
                          const glued = plan.segs[si() + 1];
                          const tail = () => {
                            if (!glued?.glued || glued.seg.k !== 'text')
                              return undefined;
                            return glued.seg.text.slice(
                              0,
                              countAt(glued.at, t())
                            );
                          };
                          return (
                            <Show
                              when={t() < ps.pick}
                              fallback={
                                <span
                                  style={{
                                    display: 'inline-block',
                                    opacity: chipAmt().toFixed(3),
                                    transform: `translateY(${((1 - chipAmt()) * 2).toFixed(2)}px)`,
                                  }}
                                >
                                  <Show
                                    when={seg.insert === 'link'}
                                    fallback={
                                      <Chip
                                        kind={seg.kind ?? 'person'}
                                        label={seg.label}
                                        tail={tail()}
                                      />
                                    }
                                  >
                                    <span class="mds-link">{seg.label}</span>
                                    {tail()}
                                  </Show>
                                </span>
                              }
                            >
                              <Show when={t() >= ps.atSign}>
                                <span class="mds-at">
                                  {/* Still just characters until Enter takes the row. */}
                                  <span>
                                    {seg.trigger ?? '@'}
                                    {seg.query.slice(0, countAt(ps.at, t()))}
                                  </span>
                                  <Palette
                                    sections={
                                      narrowed() ? seg.narrow : seg.wide
                                    }
                                    amount={openAmt()}
                                    above={seg.above}
                                  />
                                </span>
                              </Show>
                            </Show>
                          );
                        }}
                      </For>
                      <Show when={writing() === bi()}>
                        <span class="mds-caret" />
                      </Show>
                    </span>

                    {/* The closing act lives inside the run it acts on. */}
                    <Show when={bi() === COMMENT_BLOCK}>
                      <Show when={barAmt() > 0.004}>
                        <span
                          class="mds-bar"
                          style={{
                            opacity: barAmt().toFixed(3),
                            transform: `translateY(${((1 - barAmt()) * 4).toFixed(2)}px)`,
                            visibility: barAmt() > 0.004 ? 'visible' : 'hidden',
                          }}
                        >
                          <For each={BAR_TOOLS}>
                            {(tool, ti) => (
                              <span
                                class={
                                  ti() === 4 && t() >= TL.toComment[1]
                                    ? 'hot'
                                    : undefined
                                }
                                style={{ position: 'relative' }}
                              >
                                <Ic
                                  icon={tool.icon}
                                  w={0.93}
                                  color="var(--c2)"
                                />
                                <Show
                                  when={
                                    ti() === 4 &&
                                    clickAmt() > 0 &&
                                    clickAmt() < 1
                                  }
                                >
                                  <span
                                    class="mds-ring"
                                    style={{
                                      opacity: (1 - clickAmt()).toFixed(3),
                                      transform: `scale(${(0.5 + clickAmt() * 0.8).toFixed(3)})`,
                                    }}
                                  />
                                </Show>
                              </span>
                            )}
                          </For>
                        </span>
                      </Show>

                      <Show when={pointerAmt() > 0.004}>
                        {(() => {
                          const at = () => cursor();
                          return (
                            <span
                              class="mds-hand"
                              style={{
                                // left/top rather than a translate, so the
                                // offsets are in the run's own box and the
                                // pointer needs nothing measured to sit in it.
                                left: `${at().x.toFixed(3)}em`,
                                opacity: pointerAmt().toFixed(3),
                                // Dips into the press and comes back out, which
                                // is the only thing on screen that says the
                                // button was clicked rather than hovered.
                                transform: `scale(${(1 - pressing() * 0.16).toFixed(3)})`,
                                'transform-origin': `${CURSOR_ORIGIN} ${CURSOR_ORIGIN}`,
                                top: `calc(100% + ${at().y.toFixed(3)}em)`,
                              }}
                            >
                              <DocsDemoPointer text={overText()} />
                            </span>
                          );
                        })()}
                      </Show>
                    </Show>
                  </span>

                  <Show when={bi() === COMMENT_BLOCK && markAmt() > 0.004}>
                    <span
                      class="mds-badge"
                      style={{
                        opacity: markAmt().toFixed(3),
                        transform: `scale(${(0.86 + markAmt() * 0.14).toFixed(3)})`,
                      }}
                    >
                      <Ic icon={IconChatTeardrop} w={0.72} color="var(--c2)" />
                      <b>1</b>
                    </span>
                  </Show>
                </span>
                <Show when={bi() === COMMENT_BLOCK && composerAmt() > 0.004}>
                  <span
                    class="mds-composer"
                    style={{
                      opacity: composerAmt().toFixed(3),
                      transform: `translateY(${((1 - composerAmt()) * 6).toFixed(2)}px)`,
                      visibility: composerAmt() > 0.004 ? 'visible' : 'hidden',
                    }}
                  >
                    <span
                      style={{
                        color: commentChars() > 0 ? 'var(--c1)' : 'var(--c4)',
                        display: 'block',
                      }}
                    >
                      <Show
                        when={commentChars() > 0}
                        fallback="Add a comment..."
                      >
                        {COMMENT_TEXT.slice(0, commentChars())}
                      </Show>
                      <Show when={t() < TL.send}>
                        <span class="mds-caret" />
                      </Show>
                    </span>
                    <span class="mds-composer-foot">
                      <span>
                        <Ic icon={IconX} w={0.79} color="var(--c4)" />
                      </span>
                      <span
                        style={{
                          'background-color':
                            'color-mix(in srgb, var(--a0) 20%, transparent)',
                        }}
                      >
                        <Ic icon={IconArrowUp} w={0.79} color="var(--a0)" />
                      </span>
                    </span>
                  </span>
                </Show>
              </div>
            </Show>
          );
        }}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Advances `t` with a single requestAnimationFrame loop accumulating real dt,
 * and only while the panel is on screen. Not setInterval, which drifts and
 * keeps running in background tabs; not a CSS keyframe timeline, because a
 * keyframe cannot type a character count and a keyframe plus a JS clock
 * reading it is two clocks.
 *
 * Reduced motion holds on REST_T -- the finished document -- and never starts
 * the loop at all. That is also the frame the prerender paints, so the static
 * HTML carries every word of the document's copy.
 */
export function DocsMarkdownGraphic() {
  const [t, setT] = createSignal(REST_T);
  let frameEl: HTMLDivElement | undefined;

  const visible = createVisible(() => frameEl, '160px');
  const reduce = () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [running, setRunning] = createSignal(false);

  // The loop exists only while it is actually running, so scrolling the panel
  // away cancels the rAF outright and coming back re-seeds `last` -- otherwise
  // the first frame back would bill the whole idle interval to a single step.
  createEffect(() => {
    // Two guards, not one. Folded together, a visitor who turns Reduce Motion
    // on mid-session and then scrolls the panel away and back re-runs this
    // effect, returns before scheduling a frame, and leaves `t` frozen
    // wherever it stopped -- which for a good stretch of the cycle is a half
    // written document or an empty one. Pinning the rest frame is what the
    // docblock above promises.
    if (reduce()) {
      setT(REST_T);
      return;
    }
    if (!visible()) return;
    // Start the story from the top the first time the panel is reached, rather
    // than from the resting frame the server painted.
    if (!untrack(running)) {
      setRunning(true);
      setT(0);
    }
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // Clamp dt. The first frame after mount, and the first after a
      // backgrounded tab resumes firing rAF, can carry a delta of hundreds of
      // ms -- unclamped that skips beats outright.
      const dt = Math.min(now - last, 64);
      last = now;
      const raw = untrack(t) + dt;
      setT(raw >= CYCLE ? raw - CYCLE : raw);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <DocsGraphicFrame
      ref={(element) => {
        frameEl = element;
      }}
      label="A Macro document typing itself in markdown: headings, bullets and checkboxes form as the syntax lands, and one @ search resolves into a person, a task, a date, an email thread and a channel."
    >
      <DocsMarkdownScene t={t} />
    </DocsGraphicFrame>
  );
}

/** Shared lighting and document surface for the docs demonstrations. */
export function DocsGraphicFrame(props: {
  children: JSX.Element;
  ref?: (element: HTMLDivElement) => void;
  label?: string;
}) {
  return (
    <div
      ref={props.ref}
      class="mdf-frame"
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    >
      <style>{`
        /*
         * The stage frame, the same one the tasks page's lifecycle animation
         * stands in (.tlc-frame, TasksLifecycle.tsx:198-225, itself lifted
         * from .email-filter-frame): a top-lit gradient wash with a warm
         * bounce in the lower right corner, and a masked 1px gradient ring
         * that paints only the ring so it never sits behind the content. The
         * two animated scenes on this site read as the same object that way.
         *
         * One deviation from the tasks page: padding. There the scene carries
         * its own 62-unit margins inside a fixed artboard, so the frame hugs
         * it; this panel is fluid, with nothing between it and the frame, so
         * the surround is the frame's own.
         */
        .mdf-frame {
          background:
            radial-gradient(ellipse 62% 58% at 100% 100%,
              color-mix(in srgb, ${GLOW_WARM} 7%, transparent) 0%,
              color-mix(in srgb, ${GLOW_WARM} 3%, transparent) 38%,
              transparent 72%),
            radial-gradient(ellipse 62% 58% at 0% 100%,
              color-mix(in srgb, ${GLOW_COOL} 7%, transparent) 0%,
              color-mix(in srgb, ${GLOW_COOL} 3%, transparent) 38%,
              transparent 72%),
            linear-gradient(to bottom,
              color-mix(in srgb, var(--c1) 34%, transparent) 0%,
              color-mix(in srgb, var(--c1) 13%, transparent) 45%,
              color-mix(in srgb, var(--c1) 5%, transparent) 78%,
              transparent 100%);
          border-radius: 8px;
          box-sizing: border-box;
          /*
           * Shorter than the document it holds, and no padding at the foot:
           * the card runs out of the bottom of the frame and is cut there,
           * which says the document carries on rather than that it stops.
           * 444 is what the animation actually reaches -- the deepest thing
           * on screen is the first mention's five-section menu at 410, now
           * that the two menus at the foot open upward instead.
           */
          height: 500px;
          margin: 0 auto;
          overflow: hidden;
          padding: 56px 56px 0;
          position: relative;
          width: 100%;
        }
        .mdf-frame::before {
          background: linear-gradient(to bottom, color-mix(in srgb, var(--c1) 14%, transparent) 0%, color-mix(in srgb, var(--c1) 9%, transparent) 45%, transparent 100%);
          border-radius: inherit;
          content: '';
          inset: 0;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          padding: 1px;
          pointer-events: none;
          position: absolute;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          z-index: 2;
        }
        /*
         * The document itself: the Figma card, a near-black surface inside a
         * single hairline that runs bright at the top left and fades towards
         * the bottom right. A masked ring again rather than a border, because
         * a border cannot run at the Figma's 124 degrees.
         */
        .mds-card {
          background-color: color-mix(in srgb, var(--b1) 88%, var(--b0));
          border-radius: 14px;
          /*
           * The Figma card is 447 units to a 10-unit body; at the 14px this
           * is set at, that is 626. 640 rounds it and leaves the longest line
           * ("Please take a look at" plus the task chip, about 550) the same
           * share of slack the Figma leaves it.
           */
          margin: 0 auto;
          max-width: 640px;
          box-shadow: var(--shadow-panel-md);
          box-sizing: border-box;
          /*
           * Fixed, so the section does not reflow on every keystroke, and set
           * by the deepest thing the animation puts on screen rather than by
           * the finished document: the palette on the last checkbox row bottoms
           * out at 488 here and, once the lines start wrapping, at 550 on a
           * 320px phone. The finished document ends around 400, so the slack
           * below it is the menu's room, not padding -- which is also how the
           * Figma frame is drawn, at 500 units against 274 of content.
           */
          /*
           * Stated, so the section does not reflow on every keystroke, and
           * set by the deepest thing the animation puts on screen rather than
           * by the finished document: the menu on the last checkbox row
           * bottoms out around 490, and nearer 550 once the lines start
           * wrapping on a phone. The finished document ends around 400, so
           * the slack under it is the menu's room -- which is how the Figma
           * frame is drawn too, at 500 units against 274 of content.
           */
          height: 580px;
          overflow: hidden;
          position: relative;
          width: 100%;
        }
        .mds-card::before {
          /*
           * Lit from the top left corner rather than along a diagonal. A
           * linear gradient at 124 degrees carries its brightness all the way
           * down the left edge, so the sides read as lit as the corner; a
           * radial falloff anchored at the corner puts the light where a
           * light actually is and lets both edges run away from it. The
           * second layer is the hairline the rest of the card keeps, so the
           * far corner still has an edge rather than none.
           */
          background:
            radial-gradient(118% 118% at 0% 0%,
              color-mix(in srgb, var(--ambient-ink) 34%, transparent) 0%,
              color-mix(in srgb, var(--ambient-ink) 13%, transparent) 26%,
              color-mix(in srgb, var(--ambient-ink) 4%, transparent) 58%,
              transparent 82%),
            linear-gradient(to bottom, color-mix(in srgb, var(--c1) 5%, transparent), color-mix(in srgb, var(--c1) 2%, transparent));
          border-radius: inherit;
          content: '';
          inset: 0;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          padding: 1px;
          pointer-events: none;
          position: absolute;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          z-index: 2;
        }
        @media (max-width: 699px) {
          .mdf-frame { height: 500px; padding: 20px 20px 0; }
          .mds-card { border-radius: 12px; }
        }
      `}</style>
      <div class="mds-card">{props.children}</div>
    </div>
  );
}
