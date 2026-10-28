import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
} from 'solid-js';
import { isServer } from 'solid-js/web';

// Scroll-driven, per-character "fade in from grey to white" reveal — the
// effect used on the manifesto heading, generalized so any display-font text
// block can share it. A character is fully lit (var(--c1)) or fully muted
// (var(--c4) @ 0.8 alpha, identical to the static greyed continuations), with
// an 8-character soft edge sweeping left-to-right as the block scrolls up.

const SOFTNESS = 8;

// A single scroll/resize listener drives every reveal on the page. Each frame
// measures all registered elements first, then commits all reveal signals, so
// the per-character style writes never force a layout between consecutive
// getBoundingClientRect() reads.
type RevealEntry = { measure: () => number; commit: (value: number) => void };
const revealEntries = new Set<RevealEntry>();
let revealRaf = 0;
let revealListenerTarget: HTMLElement | Window | null = null;

function flushReveals() {
  revealRaf = 0;
  const pending: Array<[RevealEntry, number]> = [];
  for (const entry of revealEntries) pending.push([entry, entry.measure()]);
  for (const [entry, value] of pending) entry.commit(value);
}

function scheduleReveals() {
  if (!revealRaf) revealRaf = requestAnimationFrame(flushReveals);
}

function ensureRevealListener() {
  if (revealListenerTarget) return;
  revealListenerTarget = document.getElementById('app-scroll-root') ?? window;
  revealListenerTarget.addEventListener('scroll', scheduleReveals, {
    passive: true,
  });
  window.addEventListener('resize', scheduleReveals, { passive: true });
}

/**
 * Returns a reveal accessor (0 → 1) tracking how far `getEl` has scrolled
 * through the reveal window (top crossing 88% → 40% of viewport height).
 * The value is quantized to per-character steps so most scroll frames are
 * no-ops for the signal — unchanged characters skip their style update.
 */
export function createScrollReveal(
  getEl: () => HTMLElement | undefined,
  charCount: number
): Accessor<number> {
  const [reveal, setReveal] = createSignal(0);
  const steps = charCount + SOFTNESS;

  const entry: RevealEntry = {
    measure: () => {
      const el = getEl();
      if (!el) return reveal();
      const rect = el.getBoundingClientRect();
      const viewport = window.innerHeight;
      const start = viewport * 0.88;
      const end = viewport * 0.4;
      const progress = (start - rect.top) / (start - end);
      const clamped = Math.min(1, Math.max(0, progress));
      return Math.round(clamped * steps) / steps;
    },
    commit: setReveal,
  };

  onMount(() => {
    ensureRevealListener();
    revealEntries.add(entry);
    setReveal(entry.measure()); // prime now that the element is in the DOM
    onCleanup(() => revealEntries.delete(entry));
  });

  return reveal;
}

/** Colour for character `index` of `total` at the current `reveal` value. */
export function revealCharColor(
  reveal: number,
  index: number,
  total: number
): string {
  const progress = reveal * (total + SOFTNESS) - index;
  const lit = Math.min(1, Math.max(0, progress / SOFTNESS));
  return `color-mix(in srgb, var(--c1) ${lit * 100}%, oklch(from var(--c4) l c h / 0.8))`;
}

export type RevealSegment = {
  text: string;
  /** Render as the static greyed continuation instead of an animated reveal. */
  muted?: boolean;
  /** Extra styling for this segment's wrapper (e.g. white-space: nowrap). */
  style?: JSX.CSSProperties;
};

/**
 * Renders a line of text where emphasized segments fade in per-character on
 * scroll and muted segments stay statically greyed. Emphasized characters
 * share one continuous left-to-right sweep; muted characters don't advance it.
 */
export function RevealText(props: {
  segments: RevealSegment[];
  style?: JSX.CSSProperties;
}) {
  let el: HTMLDivElement | undefined;
  const total = props.segments.reduce(
    (n, s) => n + (s.muted ? 0 : s.text.length),
    0
  );
  const reveal = createScrollReveal(() => el, total);

  let running = 0;
  const bases = props.segments.map((segment) => {
    const base = running;
    if (!segment.muted) running += segment.text.length;
    return base;
  });

  return (
    <div ref={el} style={props.style}>
      <For each={props.segments}>
        {(segment, segIndex) => {
          if (segment.muted) {
            return (
              <span
                style={{ color: 'var(--c4)', opacity: '0.8', ...segment.style }}
              >
                {segment.text}
              </span>
            );
          }
          // Prerendered HTML keeps the text whole (per-character spans
          // fragment it for crawlers); the reveal only runs client-side.
          if (isServer) {
            return (
              <span style={{ color: 'var(--c1)', ...segment.style }}>
                {segment.text}
              </span>
            );
          }
          const base = bases[segIndex()];
          const chars = segment.text.split('');
          const body = (
            <For each={chars}>
              {(char, i) => (
                <span
                  style={{
                    color: revealCharColor(reveal(), base + i(), total),
                  }}
                >
                  {char}
                </span>
              )}
            </For>
          );
          return segment.style ? (
            <span style={segment.style}>{body}</span>
          ) : (
            body
          );
        }}
      </For>
    </div>
  );
}
