import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';
import { isServer } from 'solid-js/web';
import AgentHandoffBackSvg from '../../../assets/graphics/tasks-agent-handoff-back.svg';
import AgentHandoffFrontSvg from '../../../assets/graphics/tasks-agent-handoff-front.svg';
import ChatIntegrationSvg from '../../../assets/graphics/tasks-chat-integration.svg';
import GuideWorkSvg from '../../../assets/graphics/tasks-guide-work.svg';

// ---------------------------------------------------------------------------
// Scroll-triggered layers for the /tasks feature graphics. Each Figma-exported
// SVG has its animatable regions wrapped in classed <g> layers (done in the
// asset itself — re-exports from Figma need those wrappers re-applied):
//   tasks-chat-integration.svg  ->  .tcg-cursor  .tcg-toolbar  .tcg-btn
//                                   .tcg-gabriel  .tcg-popup
//   tasks-agent-handoff-{back,front}.svg  ->  composed in CSS, no inner
//                                            layer classes needed
//   tasks-guide-work.svg        ->  .tgw-popup
// A single scroll listener (same registry pattern as RevealText) flips an
// is-active class once a graphic's center rises past the trigger line; CSS
// transitions with staggered delays play the choreography forward, and play
// it back in inverse order when the class is removed on the way up. A small
// hysteresis band keeps the boundary from flickering. During prerender and
// under prefers-reduced-motion the class is pinned on, so the completed
// composition is what gets rendered.
// ---------------------------------------------------------------------------

type Entry = { measure: () => boolean; commit: (value: boolean) => void };
const entries = new Set<Entry>();
let raf = 0;
let listenerTarget: HTMLElement | Window | null = null;

function flush() {
  raf = 0;
  const pending: Array<[Entry, boolean]> = [];
  for (const entry of entries) pending.push([entry, entry.measure()]);
  for (const [entry, value] of pending) entry.commit(value);
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(flush);
}

function ensureListener() {
  if (listenerTarget) return;
  listenerTarget = document.getElementById('app-scroll-root') ?? window;
  listenerTarget.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
}

/** True once the element's center rises above 72% of the viewport; false
    again only after it sinks back below 78% (hysteresis against jitter). */
function createScrollTrigger(
  getEl: () => HTMLElement | undefined
): Accessor<boolean> {
  if (isServer) return () => true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    return () => true;
  const [active, setActive] = createSignal(false);
  const entry: Entry = {
    measure: () => {
      const el = getEl();
      if (!el) return active();
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const viewport = window.innerHeight;
      if (active()) return center <= viewport * 0.78;
      return center <= viewport * 0.72;
    },
    commit: setActive,
  };
  onMount(() => {
    ensureListener();
    entries.add(entry);
    schedule();
  });
  onCleanup(() => entries.delete(entry));
  return active;
}

// ---------------------------------------------------------------------------
// Seamlessly integrated with chat: the Create Task button clicks, then
// Gabriel's reply fades in, then the task preview popup fades in.
// ---------------------------------------------------------------------------

export function ChatIntegrationAnimated() {
  let el: HTMLDivElement | undefined;
  const active = createScrollTrigger(() => el);
  return (
    <div
      ref={el}
      class="tcg-anim"
      classList={{ 'is-active': active() }}
      role="img"
      aria-label="A chat message becoming a task, previewed inline from the thread"
      style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}
    >
      <style>{`
        /* The svg and the ripple share a box so the ripple can be placed in
           artboard proportions. */
        .tcg-anim .tcg-stage { position: relative; width: min(560px, 100%); }
        .tcg-anim svg {
          display: block;
          height: auto;
          width: 100%;
          /* Lifts the panel off the page. On the svg ROOT a filter resolves in
             CSS px (a filter on a child would use artboard units), and the
             shadow is cast from the whole composition's silhouette — so the
             pieces that fade in bring their own shadow with them rather than
             it appearing all at once. */
          filter: drop-shadow(0 20px 44px rgb(0 0 0 / 0.5));
        }
        /* The expanding click ring. An overlaid element rather than a shape in
           the SVG: the asset gets re-exported from Figma regularly and anything
           added inside it has to be re-applied by hand, so this stays out here.
           Geometry is the Create Task button's own, as fractions of the 367x207
           artboard — rect x 207.5 y 9.5, 82x18, rx 6:
             left 207.5/367   top 9.5/207   width 82/367   height 18/207
           and the radius as a fraction of the ring itself, 6/82 by 6/18.
           Re-measure these whenever the asset is re-sourced — successive
           redesigns have moved this button from 400x182 to 369x207 to here,
           and the toolbar it sits in has moved to the top of the panel. */
        .tcg-anim .tcg-ripple {
          border: 1px solid #FF8F00;
          border-radius: 7.32% / 33.33%;
          height: 8.696%;
          left: 56.540%;
          opacity: 0;
          pointer-events: none;
          position: absolute;
          top: 4.589%;
          transform-origin: center;
          width: 22.343%;
        }
        @keyframes tcg-ripple {
          0%   { opacity: 0.55; transform: scale(1); }
          70%  { opacity: 0.18; transform: scale(1.28); }
          100% { opacity: 0; transform: scale(1.45); }
        }
        /* The cursor and the Create Task popup now play as part of the
           sequence rather than being there from the start, so the beat reads
           as: the pointer arrives, the action menu opens, the button is
           clicked, the reply lands, the task appears.

           These are SVG children, so lengths in their transforms resolve in
           the artboard's USER UNITS (367x207), not CSS px — the small numbers
           below are deliberate, and a px-sized value here would fly across the
           whole panel. */
        .tcg-anim .tcg-cursor {
          opacity: 0;
          transform: translate(7px, 9px);
          transition: opacity 0.34s ease 0s, transform 0.42s ease 0s;
        }
        .tcg-anim .tcg-toolbar {
          opacity: 0;
          transform: scale(0.96);
          transform-box: fill-box;
          transform-origin: center;
          transition: opacity 0.32s ease 0s, transform 0.32s ease 0s;
        }
        .tcg-anim.is-active .tcg-cursor {
          opacity: 1;
          transform: none;
          transition-delay: 0.12s;
        }
        .tcg-anim.is-active .tcg-toolbar {
          opacity: 1;
          transform: none;
          transition-delay: 0.46s;
        }
        .tcg-anim.is-active .tcg-ripple { animation: tcg-ripple 0.52s ease-out 0.98s; }
        .tcg-anim .tcg-btn { transform-box: fill-box; transform-origin: center; }
        @keyframes tcg-press {
          0%, 100% { transform: scale(1); }
          45% { transform: scale(0.972); }
        }
        /* The click itself: a flash that blooms outward and fades, so the press
           reads as the thing that triggers the reply and the popup rather than
           the sequence just starting on its own. Accent-coloured to match the
           button, which the revamped asset draws in #FF8F00 — it was green when
           the button was. Blur is in the artboard's user units (369x207), not
           px — a filter on an SVG child resolves in user space — so these small
           numbers are the intended radii. */
        @keyframes tcg-pulse {
          0%   { filter: drop-shadow(0 0 0 rgba(255, 143, 0, 0)) brightness(1); }
          18%  { filter: drop-shadow(0 0 2px rgba(255, 143, 0, 0.4)) brightness(1.12); }
          55%  { filter: drop-shadow(0 0 4px rgba(255, 143, 0, 0.16)) brightness(1.04); }
          100% { filter: drop-shadow(0 0 6px rgba(255, 143, 0, 0)) brightness(1); }
        }
        /* The click waits for the popup it lives inside to finish opening
           (0.46s delay + 0.32s), so it fires at 0.98s.

           Deliberately quick and understated: a real click is a fast, small
           event, and the earlier version (0.68s dip to 0.93, a 0.85s glow at
           0.85 alpha and brightness 1.4) read as the button announcing itself.
           Roughly halved in duration and cut to about a third of the intensity
           across all three parts — dip, glow, and ring — so it registers as a
           press without competing with the reply and task preview that follow.

           A side benefit of the shorter ring: it now finishes at ~1.5s, just
           before the reply at 1.65s, where previously it ran to 2.03s and
           overlapped it. The downstream delays are unchanged. */
        .tcg-anim.is-active .tcg-btn {
          animation: tcg-press 0.34s ease 0.98s, tcg-pulse 0.42s ease-out 0.98s;
        }
        .tcg-anim .tcg-gabriel {
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.7s ease 0.3s, transform 0.7s ease 0.3s;
        }
        .tcg-anim .tcg-popup {
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.7s ease 0s, transform 0.7s ease 0s;
        }
        .tcg-anim.is-active .tcg-gabriel { opacity: 1; transform: none; transition-delay: 1.65s; }
        .tcg-anim.is-active .tcg-popup { opacity: 1; transform: none; transition-delay: 2.5s; }
        @media (prefers-reduced-motion: reduce) {
          .tcg-anim .tcg-gabriel, .tcg-anim .tcg-popup,
          .tcg-anim .tcg-cursor, .tcg-anim .tcg-toolbar {
            opacity: 1 !important; transform: none !important; transition: none !important;
          }
          .tcg-anim .tcg-btn { animation: none !important; }
          .tcg-anim .tcg-ripple { animation: none !important; opacity: 0 !important; }
        }
      `}</style>
      <div class="tcg-stage">
        <ChatIntegrationSvg aria-hidden="true" />
        <span class="tcg-ripple" aria-hidden="true" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag team with agents. The export arrives as one artboard holding two
// overlapping panels; scripts/splitSvgPanels.ts cuts it into a back panel (the
// thread) and a front panel (the task the agent is working), and the overlap is
// re-created here. Two reasons to compose in CSS rather than in the artwork:
//
//   1. A filter or treatment on "the panel behind" needs the panel behind to be
//      its own element. In one file it is a subtree of the same svg, so any
//      filter hits the whole composition.
//   2. The animation no longer needs classes inside the asset. Each panel is a
//      wrapper we own, so a re-export cannot drop the animation hooks — which
//      is what used to happen with .tah-card / .tah-arrow.
//
// Percentages come from the original 477x315 artboard: the back panel occupies
// 0,0 400x130 of it and the front panel's viewBox is 131,67 346x248 (that box
// includes the card's own drop-shadow filter region, so the card lands in the
// right place without the shadow being clipped). Re-derive them if the export's
// artboard changes.
// ---------------------------------------------------------------------------

export function AgentHandoffAnimated() {
  let el: HTMLDivElement | undefined;
  const active = createScrollTrigger(() => el);
  return (
    <div
      ref={el}
      class="tah-anim"
      classList={{ 'is-active': active() }}
      role="img"
      aria-label="Mentioning the Macro agent in a thread and it working the linked task"
      style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}
    >
      <style>{`
        /* The stage reserves the original artboard's aspect so both panels can
           be placed as percentages of it. */
        /* Aspect stops at the card's real bottom (y=301), not at the front
           panel's viewBox bottom (y=315). Those last 14 artboard units are the
           card's own drop-shadow margin, and reserving them left 20px of empty
           height under the composition, which made this section ~60px taller
           than its neighbour for no visible reason. The shadow now renders in
           the overflow — nothing clips here — so the artwork is unchanged and
           only the reserved box shrinks. */
        .tah-anim .tah-stage {
          aspect-ratio: 477 / 301;
          position: relative;
          width: min(560px, 100%);
        }
        .tah-anim .tah-stage > div { position: absolute; }
        .tah-anim .tah-stage svg { display: block; height: auto; width: 100%; }

        /* ---- the panel behind -------------------------------------------
           Treatment knob. Everything applied to the thread panel goes on this
           one rule, so it can be swapped without touching the composition.
           The filter is a variable to make that a one-line change.

           Alternatives worth trying, in place of the value below:
             --behind-filter: blur(1.5px) brightness(0.82);          recede
             --behind-filter: saturate(0.45) brightness(0.7);        desaturate
             --behind-filter: brightness(0.6) contrast(1.15);        sink back
             --behind-filter: none;                                 flat
           and independently of the filter, --behind-opacity below. */
        .tah-anim .tah-behind {
          --behind-filter: brightness(0.78) saturate(0.8);
          --behind-opacity: 1;
          filter: var(--behind-filter);
          left: 0%;
          opacity: var(--behind-opacity);
          top: 0%;
          width: 83.857%;
        }

        /* ---- the panel in front -----------------------------------------
           Carries its own shadow from the asset, so no filter here — a CSS
           filter would double it. */
        .tah-anim .tah-front {
          left: 27.463%;
          /* 67/301 — re-derived for the trimmed stage height above. */
          top: 22.259%;
          width: 72.537%;
        }

        /* The front panel drops in over the thread. The back panel is present
           from the start: it is the context the agent is being asked in. */
        .tah-anim .tah-front {
          opacity: 0;
          transform: translateY(-18px);
          transition: opacity 0.5s ease 0s, transform 0.5s ease 0s;
        }
        .tah-anim.is-active .tah-front {
          opacity: 1;
          transform: none;
          transition-delay: 0.35s;
        }
        @media (prefers-reduced-motion: reduce) {
          .tah-anim .tah-front { opacity: 1 !important; transform: none !important; transition: none !important; }
        }
      `}</style>
      <div class="tah-stage">
        <div class="tah-behind">
          <AgentHandoffBackSvg aria-hidden="true" />
        </div>
        <div class="tah-front">
          <AgentHandoffFrontSvg aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guide-the-work hero: the task detail popup fades in over the list.
// ---------------------------------------------------------------------------

export function GuideWorkAnimated() {
  let el: HTMLDivElement | undefined;
  const active = createScrollTrigger(() => el);
  return (
    <div
      ref={el}
      class="tgw-anim"
      classList={{ 'is-active': active() }}
      role="img"
      aria-label="A task list with the selected task's status, checklist, and activity panel"
      style={{ width: '100%' }}
    >
      <style>{`
        .tgw-anim svg { display: block; height: auto; margin-inline: auto; width: 100%; }
        .tgw-anim .tgw-popup {
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .tgw-anim.is-active .tgw-popup { opacity: 1; transform: none; }
        @media (prefers-reduced-motion: reduce) {
          .tgw-anim .tgw-popup { opacity: 1 !important; transform: none !important; transition: none !important; }
        }
      `}</style>
      <GuideWorkSvg aria-hidden="true" />
    </div>
  );
}
