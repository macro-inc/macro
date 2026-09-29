import { For, type JSX, Show } from 'solid-js';
import sharedImage from '../../../assets/graphics/chat-hero-shared-image.webp';
import IconAgentChatMark from '../../../assets/icons/chat-scene/agent-chat-mark.svg';
import IconArrowUp from '../../../assets/icons/chat-scene/arrow-up.svg';
import IconAttachmentImage from '../../../assets/icons/chat-scene/attachment-image.svg';
import IconCall from '../../../assets/icons/chat-scene/call.svg';
import IconHash from '../../../assets/icons/chat-scene/channel-hash.svg';
import IconHashPlaceholder from '../../../assets/icons/chat-scene/channel-hash-placeholder.svg';
import IconCircleNotch from '../../../assets/icons/chat-scene/circle-notch.svg';
import IconDocLink from '../../../assets/icons/chat-scene/doc-link.svg';
import IconEmailThread from '../../../assets/icons/chat-scene/email-thread.svg';
import emojiEyes from '../../../assets/icons/chat-scene/emoji-eyes.webp';
import emojiFire from '../../../assets/icons/chat-scene/emoji-fire.webp';
import IconMcpGithub from '../../../assets/icons/chat-scene/mcp-github.svg';
import IconPaperclip from '../../../assets/icons/chat-scene/paperclip.svg';
import IconReactionAdd from '../../../assets/icons/chat-scene/reaction-add.svg';
import IconTaskGlyph from '../../../assets/icons/chat-scene/task-glyph.svg';
import IconTaskPriority from '../../../assets/icons/chat-scene/task-priority.svg';
import IconTaskInProgress from '../../../assets/icons/chat-scene/task-status-progress.svg';
import IconTaskInReview from '../../../assets/icons/chat-scene/task-status-review.svg';
import IconTextAa from '../../../assets/icons/chat-scene/text-aa.svg';
import avatarAidan from '../../../assets/people/aidan.webp';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJacob from '../../../assets/people/jacob-work.webp';
import avatarJulia from '../../../assets/people/julia.webp';
import avatarTeo from '../../../assets/people/teo.webp';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

// ---------------------------------------------------------------------------
// The two hero panels, as DOM rather than as exported SVG.
//
// Sources, both in Aidan Sketches (IOH8EtjS7V8rmxnbJzFZ2A):
//   ChannelChat9-16  1148:7177  600 x 589
//   AgentChat9-16    1148:7114  350 x 404
//
// Every number below is the frame's own, in artboard units. The panel is laid
// out at that fixed size and then `zoom`ed to whatever width its column gives
// it -- zoom rather than transform: scale, because zoom reflows, so the text
// is laid out at the final size and stays crisp instead of being a scaled
// bitmap of itself. The wrapper carries the artboard's aspect-ratio so the
// page reserves the right height before the observer has run.
//
// Every glyph is an exported asset from the frame (src/assets/icons/chat-scene),
// not a hand-drawn path: these are product icons, and redrawing them from a
// screenshot gets the weights and the corner radii subtly wrong.
//
// Two departures from a literal translation, both deliberate:
//
//   - Figma fakes an inline icon by padding the string with spaces and
//     absolutely positioning the glyph over the gap (see the `left-[172.5px]`
//     nodes in the export). Here they are real inline-flex spans, so they
//     track the text at any width instead of drifting off it the moment a
//     line wraps.
//   - The two emoji reactions ship as images rather than as characters, so
//     every reader sees the artwork the frame was drawn with instead of
//     their own platform's emoji font. They are rendered off the system
//     Apple Color Emoji strike and trimmed to their ink, which is why the
//     sizes below are a height and an auto width rather than the frame's
//     square boxes.
//
// The motion is deliberately small: the messages arrive on a stagger and the
// agent's status notch spins. It is CSS keyframes rather than the clock-driven
// scene graph TasksLifecycleScene and ChannelPreviewGraphic use, because there
// is no seeking or scrubbing to support here, and keyframes start from their
// own first frame at first paint -- a prerendered hero would otherwise flash
// its settled state before the clock took over.
// ---------------------------------------------------------------------------

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const CHANNEL_W = 600;
export const CHANNEL_H = 589;
export const AGENT_W = 350;
export const AGENT_H = 404;

export type ChannelsHeroPanelProps = {
  /** The stage hands these down; role is the ARIA union, not a free string. */
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  'aria-label'?: string;
  style?: JSX.CSSProperties;
};

/**
 * The shell both panels share: the frame, its edge, the diagonal sheen the
 * frames carry, and the scaling.
 *
 * The style block is emitted per panel rather than once for the page. The
 * rules are identical and idempotent, and the alternative -- a module-level
 * "already emitted" flag -- is exactly the kind of state that desynchronises
 * between the server render and the client.
 */
function Panel(props: {
  stageW: number;
  stageH: number;
  /** Degrees of the frame's own sheen gradient. */
  sheen: number;
  panelProps: ChannelsHeroPanelProps;
  children: JSX.Element;
}) {
  return (
    <div
      role={props.panelProps.role}
      aria-label={props.panelProps['aria-label']}
      style={{
        'aspect-ratio': `${props.stageW} / ${props.stageH}`,
        /* The scale below is read off this box, so the artboard sizes itself
           with no measurement: no observer, no signal, and -- the reason it
           is worth doing this way -- nothing to miss on the first paint. A
           JS-measured zoom renders one frame at 1:1 before the callback
           lands, which on a hero is a visible snap. */
        'container-type': 'inline-size',
        position: 'relative',
        width: '100%',
        ...props.panelProps.style,
      }}
    >
      <style>{PANEL_CSS}</style>
      <div
        aria-hidden="true"
        class="chh"
        style={{
          height: `${props.stageH}px`,
          width: `${props.stageW}px`,
          zoom: `calc(100cqw / ${props.stageW}px)`,
        }}
      >
        {props.children}
        {/* The frame's own sheen: a wide diagonal wipe at 15% over the whole
            panel, which is what keeps the top-left corner from reading as
            flat black. The page lays its own lighting over the top of this
            (PanelLighting in RouteChannels); both are in the frame. */}
        <span
          class="chh-sheen"
          style={{
            background: `linear-gradient(${props.sheen}deg, rgb(255 255 255 / 0.2) 11%, rgb(255 255 255 / 0) 88%)`,
          }}
        />
        <span aria-hidden="true" class="chh-edge" />
      </div>
    </div>
  );
}

/** An exported glyph at an exact size. */
function Ic(props: { icon: typeof IconHash; size: number; class?: string }) {
  const Glyph = props.icon;
  return (
    <Glyph
      class={props.class}
      style={{
        display: 'block',
        height: `${props.size}px`,
        width: `${props.size}px`,
      }}
    />
  );
}

/** A message row's entrance, as a stagger index. */
const step = (i: number): JSX.CSSProperties => ({
  'animation-delay': `${90 + i * 130}ms`,
});
/** An entrance on the clock rather than in the queue, for the one beat that
    is not just the next row arriving. */
const stepAt = (ms: number): JSX.CSSProperties => ({
  'animation-delay': `${ms}ms`,
});

type CycleBeat = 1 | 2;
/** The two beats of the repeating exchange, on the clock: the ask lands
    once the staggered rows have finished arriving, and the answer 900ms
    behind it. */
const CYCLE_DELAY: Record<CycleBeat, number> = { 1: 1200, 2: 2100 };
const cycleClass = (beat: CycleBeat) =>
  beat === 2 ? 'chh-cycle-2' : 'chh-cycle';

const PANEL_CSS = `
  .chh, .chh * { box-sizing: border-box; }
  /* Grayscale antialiasing, matching the rule the page applies to svg text:
     macOS defaults to subpixel AA, which thickens stems a notch against the
     Figma source. The page's own rule targets svg text and misses a DOM
     scene. */
  .chh {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background: #060709;
    /* Transparent, and the visible edge is .chh-edge below. Kept rather
       than removed so the box metrics do not move: with border-box sizing,
       dropping it would hand the pixel back to the interior. */
    border: 0.5px solid transparent;
    border-radius: 14px;
    color: #fff;
    display: flex;
    flex-direction: column;
    font-family: ${appFont};
    left: 0;
    line-height: normal;
    overflow: hidden;
    position: absolute;
    top: 0;
  }
  .chh-sheen {
    inset: 0;
    opacity: 0.15;
    pointer-events: none;
    position: absolute;
  }
  /* The frame's edge is graded, not flat. Figma's codegen reports it as a
     solid rgba(206,206,206,0.4), which is only its brightest stop -- so the
     numbers here are read off the frame's own render instead, sampling the
     border and solving each pixel back through the 0.5px coverage to the
     alpha behind it:

       top edge     0.30 at the corner, 0.14 a quarter across, 0.02 at half
       left edge    0.30, 0.20 at half height, 0.10 near the bottom
       corners      0 at top-right, warm at bottom-right

     That is one linear ramp falling about three times faster across than
     down, which a 110deg line at 0.30 fits to about a percent. It is not
     what ships: on the page that reads as a lit left edge more than a lit
     top one, so the axis is turned to 160deg and the peak eased to 0.24 --
     the light now holds along the whole top and is gone by about 60% of
     the way down the sides. A deliberate departure from the frame, not a
     mismeasurement. The bottom-right returns warm rather than neutral --
     the frame's "HotBottom" style -- as the second layer, the same ramp
     run back the other way.

     Drawn with the masked padding-box recipe, because a CSS border cannot
     hold a gradient and border-image drops the radius. */
  .chh-edge {
    background:
      linear-gradient(160deg, rgb(232 232 232 / 0.24) 0%, transparent 46%),
      linear-gradient(340deg, rgb(255 143 0 / 0.11) 0%, transparent 46%);
    border-radius: inherit;
    inset: 0;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    padding: 0.5px;
    pointer-events: none;
    position: absolute;
    z-index: 9;
  }
  .chh p { margin: 0; }

  /* Header */
  .chh-head {
    align-items: center;
    border-bottom: 0.5px solid #353535;
    display: flex;
    flex-shrink: 0;
    justify-content: space-between;
    padding: 8px;
    width: 100%;
  }
  .chh-title { font-size: 10px; font-weight: 600; white-space: nowrap; }
  .chh-tabs {
    background: #000;
    border: 0.5px solid #1f1f1f;
    border-radius: 7px;
    display: flex;
    gap: 4px;
    padding: 2.5px;
  }
  .chh-tab {
    border: 0.5px solid transparent;
    border-radius: 5px;
    color: #8b8b8b;
    font-size: 10px;
    font-weight: 500;
    padding: 3px 6px 4px;
    white-space: nowrap;
  }
  .chh-tab-on { background: #16191f; border-color: #353535; color: #fff; }
  .chh-faces { align-items: center; display: flex; }
  .chh-faces > * { margin-right: -2px; }
  .chh-faces > :last-child { margin-right: 0; }
  .chh-face { border-radius: 999px; flex-shrink: 0; object-fit: cover; }
  .chh-face-ring { border: 1px solid #16191f; }
  .chh-overflow { color: #bfbfbf; font-size: 8px; font-weight: 500; padding: 0 3px; }
  .chh-callbtn {
    align-items: center;
    background: #16191f;
    border: 0.5px solid #353535;
    border-radius: 7px;
    display: flex;
    height: 20px;
    justify-content: center;
    width: 20px;
  }

  /* Body + rows */
  .chh-body {
    display: flex;
    flex: 1 0 0;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    padding: 16px 8px 8px;
    position: relative;
    width: 100%;
  }
  .chh-stream { display: flex; flex-direction: column; gap: 16px; width: 100%; }
  .chh-msg { display: flex; gap: 10px; padding: 1px 4px; width: 100%; }
  /* A reply: indented to the thread's column, with room for the rail. */
  .chh-thread { display: flex; flex-direction: column; gap: 8px; padding-left: 32px; width: 100%; }
  .chh-thread .chh-msg { padding: 1px 6px 1px 10px; }
  .chh-col { display: flex; flex: 1 0 0; flex-direction: column; gap: 3px; min-width: 0; }
  .chh-who {
    align-items: flex-start;
    display: flex;
    font-size: 10px;
    justify-content: space-between;
    padding-bottom: 2px;
    white-space: nowrap;
    width: 100%;
  }
  .chh-name { font-weight: 600; }
  .chh-time { color: #8b8b8b; }
  /* The timestamp sits at the row's right edge, so the copy has to stop
     short of it rather than at the panel's own padding: 16, which is what
     the frame uses, lets a long line run to within a few units of the time
     above it. 56 clears the widest stamp (10:14 AM is 42) with room. */
  .chh-text { font-size: 10px; padding-right: 56px; }
  .chh-mention { color: #ff8f00; font-weight: 500; position: relative; }
  /* The highlight behind a mention. Figma draws it as a rectangle pinned to
     a measured x; as a background on the span it cannot come adrift. */
  .chh-mention::before {
    background: rgb(255 143 0 / 0.2);
    border-radius: 2px;
    content: '';
    inset: -1px -1.5px;
    position: absolute;
    z-index: -1;
  }
  /* Inline links to other objects: an icon, then the title underlined. */
  .chh-link {
    align-items: center;
    display: inline-flex;
    gap: 2px;
    vertical-align: -2px;
  }
  .chh-link-title {
    text-decoration: underline;
    text-decoration-skip-ink: none;
    text-decoration-thickness: 0.5px;
    text-underline-offset: 1.5px;
  }
  .chh-chip { align-items: center; display: inline-flex; gap: 3px; vertical-align: -2px; }

  /* The attachment card */
  .chh-card {
    border: 0.5px solid #353535;
    border-radius: 8px;
    overflow: hidden;
    width: 200px;
  }
  .chh-card img {
    border-bottom: 0.5px solid #353535;
    display: block;
    height: 100px;
    object-fit: cover;
    width: 100%;
  }
  .chh-cardfoot {
    align-items: center;
    color: #8b8b8b;
    display: flex;
    font-size: 8px;
    justify-content: space-between;
    padding: 4px;
  }

  /* Reactions. The extra top margin is on top of the column gap: 8 reads as
     part of the message, and these are a response to it. */
  .chh-reactions { display: flex; gap: 4px; align-items: center; margin-top: 4px; }
  .chh-reaction {
    align-items: center;
    background: #16191f;
    border: 0.5px solid #353535;
    border-radius: 4px;
    color: #8b8b8b;
    display: flex;
    font-size: 8px;
    font-weight: 500;
    gap: 4px;
    height: 17px;
    padding: 4px;
  }
  .chh-reaction-on { background: rgb(255 143 0 / 0.2); border-color: #ff8f00; color: #ff8f00; }
  /* Trimmed to their ink, so each is sized on the axis the frame fills: the
     flame is 12 tall in a 12 box, the eyes 12 wide in a 12 by 9 one. Both
     axes are stated rather than left to auto, so the reaction pill does not
     reflow between first paint and the image landing. */
  .chh-emoji { display: block; }

  /* The agent */
  .chh-agentface {
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
  .chh-agentmeta { align-items: center; display: flex; gap: 3px; }
  .chh-agentmeta .chh-time { font-size: 10px; }

  /* The thread rail. It belongs to the message it comes OUT of rather than
     the one it lands on, and it stretches: top and bottom pin it to the two
     avatar centre lines, so it spans whatever sits between them -- a
     one-line message in the top hero, a two-line agent post with a strip of
     reactions under it in the closing one. It used to be a fixed 45.5 tall,
     which was exactly right for the hero and left a gap everywhere else.

     15 is an avatar's centre from the top of its row (1 of row padding plus
     half of 28); 31 below the group is the next group's, across a 16 gap.
     The drawing is in two pieces because only the straight part may
     stretch: the elbow keeps the frame's curve at the frame's size.

     No z-index anywhere in the stream any more. The rail is emitted before
     its own message, and the group it reaches down into comes after it, so
     plain DOM order paints every avatar over it. Hanging the rail upward
     out of the reply, as this did before, is what needed the rows numbered
     in reverse. */
  /* A message and whatever hangs under it are one column. The thread block
     below sets the same shape; a top-level row had no gap at all, which is
     what left the reactions jammed against the text of an agent post. */
  .chh-group { display: flex; flex-direction: column; gap: 8px; position: relative; }
  .chh-rail { bottom: -31px; left: 17.75px; position: absolute; top: 15px; width: 26.5px; }
  .chh-rail-line { background: #353535; bottom: 20.25px; left: 0; position: absolute; top: 0; width: 0.5px; }
  .chh-rail-elbow { bottom: 0; display: block; left: 0; position: absolute; }
  .chh-face, .chh-agentface { position: relative; }

  /* Composer */
  .chh-composer {
    background: #0d0e10;
    border: 0.5px solid #353535;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 4px 4px 6px;
    width: 100%;
  }
  .chh-composer-row { align-items: center; display: flex; justify-content: space-between; width: 100%; }
  .chh-placeholder {
    align-items: center;
    color: #353535;
    display: flex;
    font-size: 10px;
    gap: 4px;
    padding: 0 2px;
    white-space: nowrap;
  }
  .chh-tools { display: flex; gap: 8px; padding: 0 2px; }
  .chh-send {
    align-items: center;
    background: rgb(191 191 191 / 0.2);
    border-radius: 6px;
    display: flex;
    justify-content: center;
    padding: 4px;
  }

  /* The DM panel */
  .chh-dm-body {
    display: flex;
    flex: 1 0 0;
    flex-direction: column;
    gap: 16px;
    justify-content: flex-end;
    min-height: 0;
    overflow: hidden;
    padding: 16px 8px 8px;
    width: 100%;
  }
  .chh-dm-stream { display: flex; flex-direction: column; gap: 8px; padding-bottom: 16px; width: 333px; }
  .chh-daymark { align-items: center; display: flex; gap: 6px; padding: 0 8px; }
  .chh-daymark span { color: #555; font-size: 8px; font-weight: 500; white-space: nowrap; }
  .chh-rule { flex: 1 0 0; height: 0.5px; }
  .chh-turns { display: flex; flex-direction: column; gap: 16px; padding: 0 8px; width: 100%; }
  .chh-turn { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; width: 100%; }
  .chh-bubble {
    background: #16191f;
    border-radius: 8px;
    font-size: 10px;
    line-height: 13px;
    padding: 8px;
  }
  /* The ask and its time are one shrink-to-fit block. The bubble used to
     stretch the whole column, which the hero's three-line question fills
     but the closing scene's one-line one does not -- that read as an empty
     bubble with a sentence in the corner. The 32 the frame indents it by is
     a ceiling now as well as a margin, so a long ask still breaks in
     exactly the same place while a short one sizes to its text.

     It sits right, the way a chat client puts your own message, and stays
     there even though the closing hero laps the channel panel over this
     one's right edge and takes a bite out of a short ask. Reading as the
     reader's own turn matters more than reading whole.

     The max-width is what keeps the long version honest: capped at the
     column less 32, its left edge lands on the same 32 the frame draws it
     at, so nothing about the hero moves.

     The stamp rides inside the block so it tucks under the bubble's right
     edge. Aligned to the column instead, it strands itself out to the
     right the moment the bubble stops filling the width. */
  .chh-ask {
    align-items: flex-end;
    align-self: flex-end;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: calc(100% - 32px);
  }
  .chh .chh-bubble-me { background: #292b2f; }
  .chh-stamp { color: #8b8b8b; font-size: 8px; font-weight: 500; padding: 0 8px; }
  .chh-note { color: #bfbfbf; font-size: 8px; padding: 0 8px; }

  /* Motion. The rows arrive on a short stagger; the agent's notch turns for
     as long as it is working. Both are keyframes rather than transitions so
     they run from first paint without a class having to be added. */
  .chh-in { animation: chh-in 420ms cubic-bezier(0.22, 0.8, 0.32, 1) both; }
  @keyframes chh-in {
    from { opacity: 0; translate: 0 5px; }
    to { opacity: 1; translate: none; }
  }
  /* The exchange at the foot of the stream is the one beat that repeats,
     and it repeats in two: the message that calls the agent in, then 900ms
     later the answer -- rail, avatar and reply as a whole. They hold, and
     they leave together, which is what chh-cycle-2 is for: the same shape
     with its hold and its exit pulled 10.71% earlier, those 900ms being
     that much of the 8.4s loop. Read against the delays, the loop is: ask
     at 1.2s, answer at 2.1s, both held to 7.5s, both gone by 8.1s, then a
     second and a half of nothing before the ask comes back. Both fade
     rather than collapse, so the rows above and the composer below never
     move. */
  .chh-cycle, .chh-cycle-2 { animation: chh-cycle 8400ms cubic-bezier(0.22, 0.8, 0.32, 1) infinite both; }
  .chh-cycle-2 { animation-name: chh-cycle-2; }
  @keyframes chh-cycle {
    0% { opacity: 0; translate: 0 5px; }
    6.4% { opacity: 1; translate: none; }
    75% { opacity: 1; translate: none; }
    81.9% { opacity: 0; translate: 0 -3px; }
    100% { opacity: 0; translate: 0 5px; }
  }
  @keyframes chh-cycle-2 {
    0% { opacity: 0; translate: 0 5px; }
    6.4% { opacity: 1; translate: none; }
    64.3% { opacity: 1; translate: none; }
    71.2% { opacity: 0; translate: 0 -3px; }
    100% { opacity: 0; translate: 0 5px; }
  }
  /* The notch is not centred in its own 9x9 export -- its circle sits at
     (4.402, 4.541) -- so spinning about the box centre made it wobble, which
     read as the ring changing width. Turned about the glyph's own centre it
     holds still. */
  .chh-spin {
    animation: chh-spin 1.6s linear infinite;
    transform-origin: 48.911% 50.451%;
  }
  @keyframes chh-spin {
    to { rotate: 360deg; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chh-in, .chh-spin, .chh-cycle, .chh-cycle-2 { animation: none; }
  }
`;

/** One spur of the reply rail: a straight drop that stretches, and the
    frame's own quarter turn at the foot of it. The elbow is the tail of the
    exported path, translated up by the 25 units of straight it followed. */
function Rail(props: { class?: string; style?: JSX.CSSProperties }) {
  return (
    <span
      class={props.class ? `chh-rail ${props.class}` : 'chh-rail'}
      style={props.style}
      aria-hidden="true"
    >
      <span class="chh-rail-line" />
      <svg
        class="chh-rail-elbow"
        width="26.5"
        height="20.5"
        viewBox="0 0 26.5 20.5"
        fill="none"
      >
        <path
          d="M0.25 0.25C0.25 11.2957 9.20431 20.25 20.25 20.25H26.25"
          stroke="#353535"
          stroke-width="0.5"
          stroke-linecap="round"
        />
      </svg>
    </span>
  );
}

function Composer(props: { channel?: string }) {
  return (
    <div class="chh-composer">
      <div class="chh-composer-row">
        <p class="chh-placeholder">
          {props.channel ? (
            <>
              Type @ to share with
              {/* Its own export: the frame draws this one in the
                  placeholder's #353535, where the hash beside a message is
                  the brighter #BFBFBF. Same glyph, different ink. */}
              <Ic icon={IconHashPlaceholder} size={12} />
              {props.channel}
            </>
          ) : (
            <>Type @ to attach files, \ to use skills</>
          )}
        </p>
      </div>
      <div class="chh-composer-row">
        <div class="chh-tools">
          <Ic icon={IconPaperclip} size={12} />
          <Ic icon={IconTextAa} size={12} />
        </div>
        <span class="chh-send">
          <Ic icon={IconArrowUp} size={14} />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The scenes
//
// Both panels are written as data rather than markup, and each one has two
// scenes: the pair in the top hero, which is the Figma frame verbatim, and a
// second pair for the closing hero. The page shows the same product twice,
// forty screens apart, and it should not be the same conversation twice --
// but it should be the same vocabulary. Keeping the content in data is what
// guarantees that: a scene can only be built out of the blocks the renderer
// below knows how to draw, so a new scene cannot quietly invent a new kind
// of message.
// ---------------------------------------------------------------------------

type IconC = typeof IconHash;

/** A run of message text. Anything that is not a string is one of the
    scene's own inline objects. */
type Part =
  | string
  | { mention: string }
  | { link: string; icon: IconC; iconSize?: number }
  | { task: string; status: IconC; by: string; faceSize?: number };

type Row = {
  who: string;
  /** Omitted for the agent, which wears the Macro mark instead. */
  face?: string;
  /** The hairline ring the frame puts on an avatar inside a thread. */
  ring?: boolean;
  time: string;
  /** Paragraphs. */
  lines: Part[][];
  /** Indented under the message above it, with a rail into it. */
  thread?: boolean;
  /** The agent's byline, e.g. Agent, working. */
  status?: string;
  /** The turning notch beside the byline. An agent that has already posted
      is not working, so the byline stands on its own. */
  spin?: boolean;
  card?: { src: string; name: string; size: string };
  /** The reactions on this message, in order. A list rather than a fixed
      pair: nobody piles five emoji on an automated digest. */
  reactions?: { kind: 'fire' | 'eyes'; count: string; lit?: boolean }[];
  /** Part of the exchange that repeats rather than arriving once, and
      which beat of it: 1 is the message that draws the agent in, 2 the
      answer. A scene whose loop is the answer alone numbers it 1. */
  cycle?: CycleBeat;
};

type ChannelScene = {
  channel: string;
  overflow: string;
  faces: string[];
  rows: Row[];
};

type AgentScene = {
  ask: Part[];
  askTime: string;
  note: string;
  /** The one-line answer that leads with a task. Omitted where the reply is
      just prose, which is the difference between a job and a question. */
  chip?: Part[];
  body: Part[][];
};

const CHANNEL_HERO: ChannelScene = {
  channel: 'marketing team',
  overflow: '+16',
  faces: [avatarTeo, avatarJulia, avatarJacob],
  rows: [
    {
      who: 'Julia',
      face: avatarJulia,
      time: '9:02 AM',
      lines: [
        [
          'Launch page kicks off today! ',
          { mention: '@Aidan' },
          ' can you own the hero section?',
        ],
      ],
    },
    {
      who: 'Aidan',
      face: avatarAidan,
      ring: true,
      time: '9:05 AM',
      thread: true,
      lines: [
        [
          'Currently working on it. Here\u2019s where the concept landed last night:',
        ],
      ],
      card: { src: sharedImage, name: 'hero-graphic-v2.png', size: '1.2 MB' },
      reactions: [
        { kind: 'fire', count: '2', lit: true },
        { kind: 'eyes', count: '2' },
      ],
    },
    {
      who: 'Jacob',
      face: avatarJacob,
      time: '9:11 AM',
      lines: [
        [
          'Read this before finalizing the copy: ',
          { link: 'Re: Onboarding feedback', icon: IconEmailThread },
          '.',
        ],
        [
          'Good stuff for the testimonial section! I\u2019ve updated ',
          { link: 'Testimonials', icon: IconDocLink },
          '.',
        ],
      ],
    },
    {
      who: 'Teo',
      face: avatarTeo,
      time: '10:14 AM',
      cycle: 1,
      lines: [
        [
          { mention: '@Macro' },
          ' can you take this up to the finish line? ',
          {
            task: 'Deploy onboarding v3',
            status: IconTaskInProgress,
            by: avatarJacob,
          },
        ],
      ],
    },
    {
      who: 'Macro',
      time: '10:14 AM',
      thread: true,
      cycle: 2,
      status: 'Agent \u2022 Working',
      spin: true,
      lines: [
        [
          'Sure thing. I\u2019ll get the PR ready, then update the task\u2019s status to In Review and hand it back to you for final approval.',
        ],
      ],
    },
  ],
};

/* The closing hero. Same blocks, deliberately not the same arrangement: the
   hero opens on a person and ends on the agent, so this one opens on the
   agent -- an automation posting its weekly digest, byline but no spinner,
   because it is finished -- and the people answer it. The reactions land on
   that post rather than on an attachment, the thread sits second rather
   than second-to-last, and there is no image at all. Six rows to the hero's
   five, so even the rhythm of the column differs. */
const CHANNEL_CLOSING: ChannelScene = {
  channel: 'releases',
  overflow: '+22',
  faces: [avatarJulia, avatarTeo, avatarGabriel],
  rows: [
    {
      who: 'Macro',
      time: '8:00 AM',
      status: 'Automation \u2022 Weekly',
      lines: [
        ['Release 4.2 is cut. 14 PRs since Monday.'],
        ['Changelog is drafted from the merged PRs and waiting on a read.'],
      ],
      reactions: [{ kind: 'eyes', count: '3' }],
    },
    {
      who: 'Julia',
      face: avatarJulia,
      ring: true,
      time: '8:14 AM',
      thread: true,
      lines: [
        [
          'Adding the migration notes to ',
          { link: 'Release 4.2', icon: IconDocLink },
          ' before this goes out.',
        ],
      ],
    },
    {
      who: 'Gabriel',
      face: avatarGabriel,
      time: '8:22 AM',
      lines: [
        [
          'Reading it now. The auth retry fix needs a callout, it changes the default backoff.',
        ],
      ],
    },
    {
      who: 'Teo',
      face: avatarTeo,
      time: '8:31 AM',
      lines: [
        [
          'Still open from last week: ',
          {
            task: 'Flaky auth retry',
            status: IconTaskInProgress,
            by: avatarJacob,
          },
        ],
      ],
    },
    {
      who: 'Jacob',
      face: avatarJacob,
      time: '8:47 AM',
      lines: [
        [
          { mention: '@Gabriel' },
          ' can you sanity check the dates before we send? The last one went out with the wrong week.',
        ],
      ],
    },
    {
      who: 'Macro',
      time: '8:48 AM',
      thread: true,
      cycle: 1,
      status: 'Agent \u2022 Working',
      spin: true,
      lines: [
        [
          'Drafted from the merged PRs. I will hold it here until Gabriel signs off, then post it to the release channel.',
        ],
      ],
    },
  ],
};

const AGENT_HERO: AgentScene = {
  ask: [
    'Can you take over the hotfix for the auth issue? Make a task to track progress, and reply to Jacob\u2019s message in bug reports when the PR is up.',
  ],
  askTime: '11:52 AM',
  note: 'Summarized 26 messages \u2022 created 1 task',
  chip: [
    'I\u2019ve created a task ',
    {
      task: 'Auth failure hotfix',
      status: IconTaskInReview,
      by: avatarJacob,
      faceSize: 10,
    },
  ],
  body: [
    [
      'Now I\u2019ve verified the fix and pushed a PR: ',
      { link: '#4987', icon: IconMcpGithub, iconSize: 10 },
      '\n',
      'I sent a reply to Jacob\u2019s message in ',
      { link: 'bug reports', icon: IconHash },
      ' as well.',
    ],
    [
      'Let me know if you want me to tweak the PR or send another message in the channel.',
    ],
  ],
};

/* The closing hero's DM. Where the hero's is a job -- take this over, file
   it, reply for me -- this one is a question, so it is shorter and has no
   task bubble: an ask, a count, and an answer. */
const AGENT_CLOSING: AgentScene = {
  ask: ['What landed in releases this week?'],
  askTime: '8:52 AM',
  note: 'Summarized 18 messages',
  body: [
    [
      'Four PRs merged. ',
      { link: '#5120', icon: IconMcpGithub, iconSize: 10 },
      ' was the big one: it moves the retry backoff off the old default.',
    ],
    [
      'Nothing is blocked. The changelog is drafted and waiting on a read from Gabriel.',
    ],
  ],
};

/** Inline runs. A newline in a string is a hard break, which is how the
    frame sets the agent's two-line paragraph. */
function Parts(props: { parts: Part[] }) {
  return (
    <For each={props.parts}>
      {(part) => (
        <Show
          when={typeof part !== 'string'}
          fallback={
            <>
              {(part as string)
                .split('\n')
                .map((t, i) => (i ? [<br />, t] : t))}
            </>
          }
        >
          <Show when={(part as { mention?: string }).mention} keyed>
            {(m: string) => <span class="chh-mention">{m}</span>}
          </Show>
          <Show when={(part as { link?: string }).link} keyed>
            {(title: string) => {
              const l = part as {
                link: string;
                icon: IconC;
                iconSize?: number;
              };
              return (
                <span class="chh-link">
                  <Ic icon={l.icon} size={l.iconSize ?? 12} />
                  <span class="chh-link-title">{title}</span>
                </span>
              );
            }}
          </Show>
          <Show when={(part as { task?: string }).task} keyed>
            {(title: string) => {
              const t = part as {
                task: string;
                status: IconC;
                by: string;
                faceSize?: number;
              };
              return (
                <span class="chh-chip">
                  <Ic icon={IconTaskGlyph} size={12} />
                  <span class="chh-link-title">{title}</span>
                  <Ic icon={t.status} size={8} />
                  <Ic icon={IconTaskPriority} size={10} />
                  <img
                    src={t.by}
                    alt=""
                    class="chh-face"
                    style={{
                      height: `${t.faceSize ?? 9}px`,
                      width: `${t.faceSize ?? 9}px`,
                    }}
                  />
                </span>
              );
            }}
          </Show>
        </Show>
      )}
    </For>
  );
}

/** What hangs under a message -- its attachment card, its reactions -- is
    inset to that message's own text rather than to its avatar: the row's
    left padding, then 28 of avatar and 10 of gap. A threaded row is padded
    10 and a top-level one 4, so the two contexts do not share a number --
    and the thread's own 32 is already on the group, so it does not count
    here. The frame draws these 8 units further left, at 40, which reads as
    a near-miss against the text above them rather than as an outdent. */
const HANG_THREAD = 10 + 28 + 10;
const HANG_TOP = 4 + 28 + 10;

/** The stagger runs over elements, not rows: a card and a reaction strip each
    take their own beat after the message they hang off. */
function withSteps(rows: Row[]) {
  let n = 0;
  const out = rows.map((row) => ({
    row,
    rowStep: row.cycle ? -1 : n++,
    cardStep: row.card ? n++ : -1,
    reactStep: row.reactions ? n++ : -1,
    /* Set on the message a rail comes out of, from the reply it goes to:
       the line is that reply's arrival, not this message's, so it fades in
       on the reply's beat -- and where the reply is a repeating block, it
       repeats with it rather than hanging into an empty column. */
    rail: null as null | { cycle?: CycleBeat; step: number },
  }));
  out.forEach((entry, i) => {
    const next = out[i + 1];
    if (next?.row.thread)
      entry.rail = { cycle: next.row.cycle, step: next.rowStep };
  });
  return out;
}

// ---------------------------------------------------------------------------
// ChannelChat9-16
// ---------------------------------------------------------------------------

function ChannelPanel(props: {
  scene: ChannelScene;
  panelProps: ChannelsHeroPanelProps;
}) {
  const rows = withSteps(props.scene.rows);
  return (
    <Panel
      stageW={CHANNEL_W}
      stageH={CHANNEL_H}
      sheen={123.75}
      panelProps={props.panelProps}
    >
      <div class="chh-head" style={{ 'padding-left': '12px' }}>
        <div style={{ 'align-items': 'center', display: 'flex', gap: '12px' }}>
          <div
            style={{ 'align-items': 'flex-end', display: 'flex', gap: '4px' }}
          >
            <Ic icon={IconHash} size={11} />
            <span class="chh-title">{props.scene.channel}</span>
          </div>
          <div class="chh-tabs">
            <span class="chh-tab chh-tab-on">Messages</span>
            <span class="chh-tab">Attachments</span>
          </div>
        </div>
        <div style={{ 'align-items': 'center', display: 'flex', gap: '16px' }}>
          <div class="chh-faces">
            <span class="chh-overflow">{props.scene.overflow}</span>
            <For each={props.scene.faces}>
              {(src, i) => (
                <img
                  src={src}
                  alt=""
                  class={
                    i() === props.scene.faces.length - 1
                      ? 'chh-face'
                      : 'chh-face chh-face-ring'
                  }
                  style={{ height: '12px', width: '12px' }}
                />
              )}
            </For>
          </div>
          <span class="chh-callbtn">
            <Ic icon={IconCall} size={10} />
          </span>
        </div>
      </div>

      <div class="chh-body">
        <div class="chh-stream">
          <For each={rows}>
            {({ row, rowStep, cardStep, reactStep, rail }) => {
              const railBeat = rail?.cycle;
              const body = (
                <>
                  <div
                    class={row.cycle ? 'chh-msg' : 'chh-msg chh-in'}
                    style={row.cycle ? undefined : step(rowStep)}
                  >
                    <Show
                      when={row.face}
                      fallback={
                        <span class="chh-agentface">
                          <MacroMarkIcon
                            style={{
                              color: '#ff8f00',
                              height: '14px',
                              width: '14px',
                            }}
                          />
                        </span>
                      }
                    >
                      <img
                        src={row.face}
                        alt=""
                        class="chh-face"
                        style={{
                          border: row.ring ? '0.5px solid #353535' : undefined,
                          height: '28px',
                          width: '28px',
                        }}
                      />
                    </Show>
                    <div class="chh-col">
                      <div class="chh-who">
                        <Show
                          when={row.status}
                          fallback={<span class="chh-name">{row.who}</span>}
                        >
                          <span class="chh-agentmeta">
                            <span class="chh-name">{row.who}</span>
                            <span class="chh-time">{row.status}</span>
                            <Show when={row.spin}>
                              <Ic
                                icon={IconCircleNotch}
                                size={9}
                                class="chh-spin"
                              />
                            </Show>
                          </span>
                        </Show>
                        <span class="chh-time">{row.time}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          'flex-direction': 'column',
                          gap: '10px',
                          width: '100%',
                        }}
                      >
                        <For each={row.lines}>
                          {(line) => (
                            <p
                              class="chh-text"
                              style={
                                row.status
                                  ? {
                                      'line-height': '13px',
                                      'padding-right': '64px',
                                    }
                                  : undefined
                              }
                            >
                              <Parts parts={line} />
                            </p>
                          )}
                        </For>
                      </div>
                    </div>
                  </div>
                  <Show when={row.card}>
                    {(card) => (
                      <div
                        class="chh-in"
                        style={{
                          ...step(cardStep),
                          padding: `0 ${row.thread ? HANG_THREAD : HANG_TOP}px`,
                        }}
                      >
                        <div class="chh-card">
                          <img src={card().src} alt="" />
                          <div class="chh-cardfoot">
                            <span
                              style={{
                                'align-items': 'center',
                                display: 'flex',
                                gap: '2px',
                              }}
                            >
                              <Ic icon={IconAttachmentImage} size={10} />
                              {card().name}
                            </span>
                            <span>{card().size}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Show>
                  <Show when={row.reactions}>
                    {(list) => (
                      <div
                        class="chh-reactions chh-in"
                        style={{
                          ...step(reactStep),
                          padding: `0 ${row.thread ? HANG_THREAD : HANG_TOP}px`,
                        }}
                      >
                        <For each={list()}>
                          {(r) => (
                            <span
                              class={
                                r.lit
                                  ? 'chh-reaction chh-reaction-on'
                                  : 'chh-reaction'
                              }
                            >
                              <Show
                                when={r.kind === 'fire'}
                                fallback={
                                  <img
                                    src={emojiEyes}
                                    alt=""
                                    class="chh-emoji"
                                    style={{ height: '9.29px', width: '12px' }}
                                  />
                                }
                              >
                                <img
                                  src={emojiFire}
                                  alt=""
                                  class="chh-emoji"
                                  style={{ height: '12px', width: '9.25px' }}
                                />
                              </Show>
                              {r.count}
                            </span>
                          )}
                        </For>
                        <Ic icon={IconReactionAdd} size={14} />
                      </div>
                    )}
                  </Show>
                </>
              );
              return (
                <div
                  class={`chh-group${row.thread ? ' chh-thread' : ''}${row.cycle ? ` ${cycleClass(row.cycle)}` : ''}`}
                  style={row.cycle ? stepAt(CYCLE_DELAY[row.cycle]) : undefined}
                >
                  <Show when={rail}>
                    {(r) => (
                      <Rail
                        class={railBeat ? cycleClass(railBeat) : 'chh-in'}
                        style={
                          railBeat
                            ? stepAt(CYCLE_DELAY[railBeat])
                            : step(r().step)
                        }
                      />
                    )}
                  </Show>
                  {body}
                </div>
              );
            }}
          </For>
        </div>

        <Composer channel={props.scene.channel} />
      </div>
    </Panel>
  );
}

export function ChatHeroChannelPanel(props: ChannelsHeroPanelProps) {
  return <ChannelPanel scene={CHANNEL_HERO} panelProps={props} />;
}

export function ChatClosingChannelPanel(props: ChannelsHeroPanelProps) {
  return <ChannelPanel scene={CHANNEL_CLOSING} panelProps={props} />;
}

// ---------------------------------------------------------------------------
// AgentChat9-16
// ---------------------------------------------------------------------------

function AgentPanel(props: {
  scene: AgentScene;
  panelProps: ChannelsHeroPanelProps;
}) {
  return (
    <Panel
      stageW={AGENT_W}
      stageH={AGENT_H}
      sheen={119.61}
      panelProps={props.panelProps}
    >
      <div class="chh-head" style={{ 'padding-left': '14px' }}>
        <div style={{ 'align-items': 'center', display: 'flex', gap: '6px' }}>
          <Ic icon={IconAgentChatMark} size={12} />
          <span class="chh-title">Agent Chat</span>
        </div>
        <span style={{ width: '24px' }} />
      </div>

      <div class="chh-dm-body">
        <div class="chh-dm-stream">
          <div class="chh-daymark">
            <span
              class="chh-rule"
              style={{
                background:
                  'linear-gradient(to right, rgb(85 85 85 / 0) 0%, #555 25%)',
              }}
            />
            <span>Today</span>
            <span
              class="chh-rule"
              style={{
                background:
                  'linear-gradient(to left, rgb(85 85 85 / 0) 0%, #555 25%)',
              }}
            />
          </div>

          <div class="chh-turns">
            {/* The ask */}
            <div class="chh-turn chh-in" style={step(0)}>
              <div class="chh-ask">
                <p class="chh-bubble chh-bubble-me">
                  <Parts parts={props.scene.ask} />
                </p>
                <span class="chh-stamp">{props.scene.askTime}</span>
              </div>
            </div>

            {/* And the answer */}
            <div class="chh-turn" style={{ gap: '4px' }}>
              <p class="chh-note chh-in" style={step(1)}>
                {props.scene.note}
              </p>
              <Show when={props.scene.chip}>
                {(chip) => (
                  <div
                    class="chh-in"
                    style={{
                      ...step(2),
                      display: 'flex',
                      'flex-direction': 'column',
                      gap: '4px',
                      'padding-right': '32px',
                    }}
                  >
                    <p
                      class="chh-bubble"
                      style={{ 'align-self': 'flex-start' }}
                    >
                      <Parts parts={chip()} />
                    </p>
                  </div>
                )}
              </Show>
              <div
                class="chh-in"
                style={{ ...step(3), 'padding-right': '32px' }}
              >
                <div
                  class="chh-bubble"
                  style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '8px',
                    width: '296px',
                  }}
                >
                  <For each={props.scene.body}>
                    {(para) => (
                      <p>
                        <Parts parts={para} />
                      </p>
                    )}
                  </For>
                </div>
              </div>
              <p class="chh-note chh-in" style={step(4)}>
                just now
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', width: '333px' }}>
          <Composer />
        </div>
      </div>
    </Panel>
  );
}

export function ChatHeroAgentPanel(props: ChannelsHeroPanelProps) {
  return <AgentPanel scene={AGENT_HERO} panelProps={props} />;
}

export function ChatClosingAgentPanel(props: ChannelsHeroPanelProps) {
  return <AgentPanel scene={AGENT_CLOSING} panelProps={props} />;
}
