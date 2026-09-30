import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

// ---------------------------------------------------------------------------
// CollabHeadline
//
// The /documents h1, played as a document being edited rather than typed. It
// opens on "Markdown documents." broken over two lines, the way a title sits in
// a narrow column, then:
//
//   1. Julia types "Collaborative " in front — to a human typing rhythm, not a
//      metronome — which bumps "Markdown" down onto the line below
//   2. Rahul drags a selection across the "ument" of "documents" a letter at a
//      time and deletes it, leaving "Markdown docs."
//   3. Julia comes back to select the "M" of "Markdown" and lowercase it, her
//      highlight lingering over the new letter before it clears
//
// landing on the real headline. After a rest it plays again from the top. The
// carets, colours and name pills are the same visual language as the
// live-cursor mocks further down the page (COLLAB_A/B there), so the headline
// reads as the product demoing itself.
//
// Four constraints shape the implementation:
//
// - The finished text must be in the markup from the very first render.
//   scripts/prerender.ts statically renders these routes, so the h1 has to
//   ship "Collaborative markdown docs." to crawlers. The animation therefore
//   starts at its END state and is rewound in onMount, which never runs
//   during SSR.
// - The two edited-away strings must never reach the markup. Neither the
//   capital "M" nor the "ument" of "documents" survives into the headline, so
//   neither can be prerendered: the capital is a text-transform on the real
//   lowercase "m", and "ument" is a client-only span that exists between
//   onMount and step 3. What a crawler reads is only ever the final copy.
// - The text must appear exactly ONCE in the DOM, so no hidden duplicate of
//   the finished headline holds the box open. Two line-heights are reserved
//   with min-height for the length of the animation instead, so step 1's bump
//   moves the text inside a box that never changes size and the sub, CTAs and
//   hero below it stay put.
// - Nothing may shift horizontally except the text being edited. The carets
//   are laid out at zero width, the name pills are absolutely positioned, and
//   the selections pad themselves with box-shadow spread rather than padding,
//   so highlighting a run cannot nudge the glyphs around it.
//
// At rest the headline is plain text nodes, one per line — no per-character
// spans — so it kerns exactly as an un-animated headline would.
// ---------------------------------------------------------------------------

/** Typed in front by the first editor. The trailing space becomes the wrap. */
const PREFIX = 'Collaborative ';
/** Lowercased by the second editor — shown as "M" until then. */
const HEAD = 'm';
/** Rest of the first word. */
const WORD = 'arkdown';
/** The space between the two words — a line break while the title stands alone. */
const GAP = ' ';
const STEM = 'doc';
/** Deleted by Rahul. Client-only: never prerendered. */
const EXTRA = 'ument';
const TAIL = 's.';

/** The headline this script is written against; anything else renders plain. */
const EXPECTED = ['Collaborative', HEAD + WORD + GAP + STEM + TAIL];
/**
 * The widest line the sequence ever lays out: the untrimmed title, after the
 * prefix has pushed it onto a line of its own.
 */
const WIDEST = (HEAD + WORD + GAP + STEM + EXTRA + TAIL).replace(/^./, (c) =>
  c.toUpperCase()
);

// Julia makes two of the three edits — she writes the line, then comes back to
// lowercase its first letter — so she keeps one identity and one colour across
// both, and Rahul's trim in between reads as someone else's hand.
const JULIA = { name: 'Julia', color: 'var(--a0)' };
const RAHUL = { name: 'Rahul', color: 'var(--a2)' };

// Steps, in order. Total run is a little under 4s.
const START_HOLD_MS = 420;
/** Julia's caret lands and is held a beat before the first character. */
const CARET_IN_MS = 260;
/** Base beat between characters, before the rhythm below stretches it. */
const CHAR_MS = 46;

/**
 * How long to wait before each letter of PREFIX lands, as a multiple of
 * CHAR_MS. Typing is not metronomic, and a constant beat is what made the
 * old headline read like a teleprinter — so these follow what the hands are
 * actually doing across "Collaborative " on a QWERTY keyboard:
 *
 * - alternating hands is quick, because the next finger is already travelling
 *   while the last one presses ("o" after "C", "a" after "l", "o" after "b")
 * - a doubled letter is the fastest thing a hand does — the second "l" is a
 *   rebound off the first, not a fresh keypress
 * - two letters sharing one finger are the slowest — "l" straight after "o"
 *   is the right ring finger having to travel from the top row to home, and
 *   is the natural hesitation in the middle of this word
 * - a stretch inside one hand costs more than a roll: "b" after "a" is left
 *   pinky to left index, and "a" after "r" comes back the other way
 * - the trailing space settles slightly, the way the end of a word does
 *
 * Index 0 is the shifted capital "C", which is paced by CARET_IN_MS instead.
 */
const RHYTHM = [
  1, 0.85, 1.45, 0.55, 0.8, 1.3, 0.8, 0.85, 1.15, 1.1, 0.8, 0.85, 1, 1.25,
];
/** No one repeats a rhythm exactly, so no two loads land identically. */
const JITTER = 0.1;
/** The finished prefix is read for a moment before the line bumps. */
const WRAP_BEAT_MS = 220;
const AFTER_WRAP_MS = 340;
/** A finished selection sits long enough to be read before the edit lands. */
const SELECT_MS = 600;
const AFTER_EDIT_MS = 400;
/** The selection is dragged a letter at a time, the way a mouse selects. */
const DRAG_MS = 85;
/** The highlight lingers on the lowercased "m", so the edit can be read. */
const CASE_LINGER_MS = 900;
/**
 * Playback rate for the whole sequence. The beats above are the composition —
 * their ratios are what make the rhythm read — and this scales them together,
 * so slowing the animation down never changes its feel. Applied once, in the
 * scheduler.
 */
const SPEED = 0.75;

const P_START = 0;
const P_TYPING = 1;
const P_WRAPPED = 2;
/** Rahul drags across "ument"... */
const P_SELECT_EXTRA = 3;
/** ...and deletes it, leaving "Markdown docs." still capitalised. */
const P_TRIMMED = 4;
/** Julia then comes back to select the "M"... */
const P_SELECT_M = 5;
/** ...and lowercases it, the highlight lingering over the new letter. */
const P_LOWERED = 6;
/** The finished headline, at rest until the sequence replays. */
const P_DONE = 7;

/** Renders the finished headline as <br />-separated lines. */
function Lines(props: { lines: string[] }) {
  return (
    <>
      {props.lines.map((line, i) => (
        <>
          {i > 0 ? <br /> : null}
          {line}
        </>
      ))}
    </>
  );
}

/** A collaborator's name pill. Absolutely positioned, so it never takes space. */
function Tag(props: { name: string; color: string }) {
  return (
    <span
      class="feat-lite-title-tag"
      style={{ 'background-color': props.color }}
    >
      {props.name}
    </span>
  );
}

/**
 * A collaborator's caret. Laid out at zero width — the negative margin cancels
 * both the bar and its own leading gap — so it can never tip a line break, and
 * it overhangs the cap height and baseline the way an editor caret does.
 */
function Caret(props: { name: string; color: string }) {
  return (
    <span
      class="feat-lite-title-caret"
      style={{ 'background-color': props.color }}
    >
      <Tag name={props.name} color={props.color} />
    </span>
  );
}

/**
 * A collaborator's live selection. Inactive it renders its children bare, so
 * the run kerns normally and no wrapper survives into the resting headline.
 */
function Selection(props: {
  active: boolean;
  name: string;
  color: string;
  children: JSX.Element;
}) {
  return (
    <Show when={props.active} fallback={props.children}>
      <span class="feat-lite-title-sel" style={{ '--sel': props.color }}>
        {/* Both of these are absolutely positioned, and both MUST come before
            the text. Anything positioned at the end of an inline box makes the
            browser snap that box's advance width, and the rounding lands
            differently at each width — so with the bar trailing, every step of
            the drag nudged the rest of the word by up to 1.3px. Leading, the
            text after the selection does not move at all. */}
        <span class="feat-lite-title-rule" aria-hidden="true" />
        <Tag name={props.name} color={props.color} />
        {props.children}
      </span>
    </Show>
  );
}

/**
 * Whether the widest line the sequence lays out still fits on one line.
 *
 * The animation is only safe to play if it does. Every state is two lines, and
 * the untrimmed title is what decides that: once the prefix takes line one, a
 * box too narrow to hold "Markdown documents." would break it again and give
 * the headline a third line, shoving the sub, CTAs and artwork down mid-edit.
 * Narrow viewports genuinely cannot fit it, and there the headline is simply
 * rendered finished. Measured against a probe carrying the headline's own font
 * rather than a character count, since this is a proportional display face.
 */
function widestLineFits(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  const probe = document.createElement('span');
  probe.textContent = WIDEST;
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;';
  probe.style.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
  probe.style.letterSpacing = cs.letterSpacing;
  document.body.appendChild(probe);
  // offsetWidth, not getBoundingClientRect(): this page can sit under a CSS
  // scale, where rects come back in visual pixels while clientWidth is in
  // layout pixels. Comparing the two measures against the wrong yardstick.
  const needed = probe.offsetWidth;
  probe.remove();
  return needed <= el.clientWidth;
}

export function CollabHeadline(props: { lines: string[] }) {
  const scripted = () =>
    props.lines.length === EXPECTED.length &&
    props.lines.every((l, i) => l === EXPECTED[i]);

  // Starts at the end state: this is what SSR renders and what crawlers read.
  const [phase, setPhase] = createSignal(P_DONE);
  const [typed, setTyped] = createSignal(PREFIX.length);
  /** Letters of EXTRA covered by Rahul's selection so far. */
  const [dragged, setDragged] = createSignal(EXTRA.length);

  /**
   * True while the title still stands on its own, before the first keystroke.
   * It holds the forced break below, and covers the beat where Julia's caret
   * has landed but she has not typed yet — without it the title would snap
   * onto one line for that beat and then split again.
   */
  const untouched = () =>
    phase() === P_START || (phase() === P_TYPING && typed() === 0);

  let box!: HTMLSpanElement;

  // Assigned in onMount and called again by the click handler. Null until then
  // (and on a viewport or motion setting that never scripts the headline), which
  // is what `replayable` keys off so a dead headline is not given a pointer
  // cursor it cannot honour.
  let replay: (() => void) | null = null;
  const [replayable, setReplayable] = createSignal(false);

  onMount(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let stopped = false;
    onCleanup(() => {
      stopped = true;
      timers.forEach(clearTimeout);
    });

    if (!scripted()) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const play = () => {
      if (stopped || !widestLineFits(box)) return;

      // Clear any beats still pending from a previous run: without this a
      // click mid-animation leaves the old schedule alive and the two runs
      // fight over the phase.
      timers.forEach(clearTimeout);
      timers.length = 0;

      let clock = 0;
      const at = (delay: number, run: () => void) => {
        clock += delay / SPEED;
        timers.push(setTimeout(run, clock));
      };

      // Rewind to the opening state, then play the three edits back in order.
      setTyped(0);
      setPhase(P_START);

      at(START_HOLD_MS, () => setPhase(P_TYPING));
      for (let i = 1; i <= PREFIX.length; i++) {
        // RHYTHM is indexed by the character this beat reveals, PREFIX[i - 1].
        const beat =
          i === 1
            ? CARET_IN_MS
            : CHAR_MS *
              (RHYTHM[i - 1] ?? 1) *
              (1 + (Math.random() * 2 - 1) * JITTER);
        at(beat, () => setTyped(i));
      }
      at(WRAP_BEAT_MS, () => setPhase(P_WRAPPED));
      // Press, then drag across the run one letter at a time, then delete it.
      at(AFTER_WRAP_MS, () => {
        setDragged(1);
        setPhase(P_SELECT_EXTRA);
      });
      for (let i = 2; i <= EXTRA.length; i++) {
        at(DRAG_MS, () => setDragged(i));
      }
      at(SELECT_MS, () => setPhase(P_TRIMMED));
      at(AFTER_EDIT_MS, () => setPhase(P_SELECT_M));
      at(SELECT_MS, () => setPhase(P_LOWERED));
      at(CASE_LINGER_MS, () => setPhase(P_DONE));

      // No self-replay: the sequence runs once and rests on the finished
      // headline until the reader clicks it.
    };

    replay = play;
    setReplayable(true);

    // Waits for the display face before the fit check: that line is a
    // different width on the fallback, so measuring early would either skip an
    // animation that fits or play one that does not. Deliberately NOT
    // requestAnimationFrame — rAF never fires in a tab that is not painting,
    // which would leave the headline stuck at its opening state for anyone who
    // opens the page in a background tab. A timeout always fires, and the fit
    // check forces its own layout.
    const fonts = document.fonts?.ready;
    if (fonts) fonts.then(() => setTimeout(play, 0));
    else setTimeout(play, 0);
  });

  return (
    // aria-hidden: the accessible heading comes from an aria-label on the <h1>,
    // so assistive tech reads one stable title rather than a mutating one.
    // pre-wrap keeps the typed trailing space, and the hold class keeps both
    // lines open while the edits play, so step 1's bump moves nothing below it.
    <span
      ref={box}
      aria-hidden="true"
      classList={{ 'feat-lite-title-hold': phase() < P_DONE }}
      onClick={() => replay?.()}
      style={{
        cursor: replayable() ? 'pointer' : undefined,
        display: 'block',
        'white-space': 'pre-wrap',
      }}
    >
      <Show when={phase() < P_DONE} fallback={<Lines lines={props.lines} />}>
        {/* Line one, typed in front of the original title. */}
        <Show when={phase() >= P_TYPING}>
          {phase() >= P_WRAPPED ? EXPECTED[0] : PREFIX.slice(0, typed())}
          <Show when={phase() === P_TYPING}>
            <Caret name={JULIA.name} color={JULIA.color} />
          </Show>
        </Show>
        <Show when={phase() >= P_WRAPPED}>
          <br />
        </Show>

        {/* Line two — the title that was already there, edited down. */}
        <Selection
          active={phase() === P_SELECT_M || phase() === P_LOWERED}
          name={JULIA.name}
          color={JULIA.color}
        >
          <span
            style={{
              'text-transform': phase() < P_LOWERED ? 'uppercase' : undefined,
            }}
          >
            {HEAD}
          </span>
        </Selection>
        {WORD}
        {/* The title breaks across two lines on its own until the prefix
            arrives; from the first keystroke it is an ordinary space, and the
            wrap that puts "Markdown documents." on line two is the real one. */}
        {untouched() ? <br /> : GAP}
        {STEM}
        <Show when={phase() < P_TRIMMED}>
          {/* Split so the highlight can grow letter by letter under the drag;
              the tail stays unselected text until the selection reaches it. */}
          <Show when={phase() === P_SELECT_EXTRA} fallback={EXTRA}>
            <Selection active name={RAHUL.name} color={RAHUL.color}>
              {EXTRA.slice(0, dragged())}
            </Selection>
            {EXTRA.slice(dragged())}
          </Show>
        </Show>
        {TAIL}
      </Show>
    </span>
  );
}
