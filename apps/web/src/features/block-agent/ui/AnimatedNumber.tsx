/**
 * Odometer-style rolling number: each digit rides a vertical strip that spins
 * to its new value when the number changes.
 *
 * Ported from opencode's `animated-number.tsx` / `animated-number.css`
 * (github.com/sst/opencode, MIT © 2025 opencode), restyled with Tailwind
 * utilities in place of the original CSS file.
 */
import { createEffect, createMemo, For, Index, on } from 'solid-js';
import { createStore } from 'solid-js/store';

/**
 * Three copies of 0-9 so a strip can overshoot in either direction before the
 * transition-end handler snaps it back to the middle copy.
 */
const TRACK = Array.from({ length: 30 }, (_, index) => index % 10);

/** Map an arbitrary strip position back onto its digit (0-9). */
function normalize(value: number): number {
  return ((value % 10) + 10) % 10;
}

/** How many cells to travel from one digit to another in a fixed direction. */
function spin(from: number, to: number, direction: 1 | -1): number {
  if (from === to) return 0;
  if (direction > 0) return (to - from + 10) % 10;
  return -((from - to + 10) % 10);
}

function Digit(props: { value: number; direction: 1 | -1 }) {
  // Start on the middle copy of the track.
  const [state, setState] = createStore({
    step: props.value + 10,
    animating: false,
  });
  let last = props.value;

  createEffect(
    on(
      () => props.value,
      (next) => {
        const delta = spin(last, next, props.direction);
        last = next;
        if (!delta) {
          setState({ animating: false, step: next + 10 });
          return;
        }

        setState('animating', true);
        setState('step', (value) => value + delta);
      },
      { defer: true }
    )
  );

  return (
    <span class="inline-block h-[1em] w-[1ch] overflow-hidden align-baseline leading-[1em] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_18%,#000_82%,transparent_100%)]">
      <span
        class="inline-flex translate-y-[calc(var(--roll-offset)*-1em)] flex-col transition-transform duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-[animating=false]:duration-0 motion-reduce:duration-0"
        data-animating={state.animating ? 'true' : 'false'}
        style={{ '--roll-offset': `${state.step}` }}
        onTransitionEnd={() => {
          // Snap back (without animating) to the equivalent middle-copy cell.
          setState('animating', false);
          setState('step', (value) => normalize(value) + 10);
        }}
      >
        <For each={TRACK}>
          {(digit) => (
            <span class="inline-flex h-[1em] w-[1ch] items-center justify-center leading-[1em]">
              {digit}
            </span>
          )}
        </For>
      </span>
    </span>
  );
}

/** A non-negative integer that rolls odometer-style when its value changes. */
export function AnimatedNumber(props: { value: number; class?: string }) {
  const target = createMemo(() => {
    if (!Number.isFinite(props.value)) return 0;
    return Math.max(0, Math.round(props.value));
  });

  const [state, setState] = createStore({
    value: target(),
    direction: 1 as 1 | -1,
  });

  createEffect(
    on(
      target,
      (next) => {
        if (next === state.value) return;
        setState({ direction: next > state.value ? 1 : -1, value: next });
      },
      { defer: true }
    )
  );

  const label = createMemo(() => state.value.toString());
  // Least-significant digit first; rendered row-reverse so digit identity is
  // stable when the number grows or shrinks a place.
  const digits = createMemo(() =>
    Array.from(label(), (char) => {
      const code = char.charCodeAt(0) - 48;
      if (code < 0 || code > 9) return 0;
      return code;
    }).reverse()
  );

  return (
    <span
      class={`inline-flex items-baseline align-baseline tabular-nums ${props.class ?? ''}`}
      aria-label={label()}
    >
      <span
        class="inline-flex w-[var(--num-width)] flex-row-reverse items-baseline justify-end overflow-hidden transition-[width] duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0"
        style={{ '--num-width': `${digits().length}ch` }}
      >
        <Index each={digits()}>
          {(digit) => <Digit value={digit()} direction={state.direction} />}
        </Index>
      </span>
    </span>
  );
}
