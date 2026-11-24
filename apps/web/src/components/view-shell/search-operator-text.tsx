import { cn } from '@ui';
import { createEffect, For, on, onCleanup, onMount, Show } from 'solid-js';

/** A run of search text; an operator is a complete, valid filter (`in:sent`). */
export type SearchTextPart = { text: string; operator: boolean };

/**
 * Splits search text into runs, marking each whitespace-separated token that
 * `isOperator` recognises. Whitespace stays in the runs, so joining them gives
 * the text back unchanged.
 */
export function splitSearchOperators(
  text: string,
  isOperator: (token: string) => boolean
): SearchTextPart[] {
  const parts: SearchTextPart[] = [];
  for (const run of text.split(/(\s+)/)) {
    if (!run) continue;

    const operator = !/^\s/.test(run) && isOperator(run);
    const last = parts.at(-1);
    if (last && !last.operator && !operator) last.text += run;
    else parts.push({ text: run, operator });
  }
  return parts;
}

/**
 * Search text with its operators drawn as tokens: accent ink on a faint accent
 * tint. The tint is a shadow, not padding, so every glyph keeps the position it
 * has in the field.
 */
export function SearchOperatorText(props: {
  parts: readonly SearchTextPart[];
}) {
  return (
    <For each={props.parts}>
      {(part) => (
        <Show when={part.operator} fallback={<span>{part.text}</span>}>
          <span
            data-search-operator=""
            class="rounded-[3px] bg-accent-bg text-accent-ink shadow-[0_0_0_2px_var(--color-accent-bg)]"
          >
            {part.text}
          </span>
        </Show>
      )}
    </For>
  );
}

// The input scrolls as the caret moves along long text; edits and selection
// can scroll it without a scroll event.
const FOLLOW_EVENTS = [
  'scroll',
  'input',
  'keyup',
  'select',
  'pointerup',
  'focus',
];

/**
 * Draws an input's text, operators marked, behind the input. The input keeps
 * its value, caret, selection and editing; it paints its own text transparent
 * (`text-transparent caret-ink`), and this layer follows its horizontal scroll.
 */
export function SearchOperatorOverlay(props: {
  parts: readonly SearchTextPart[];
  input: () => HTMLInputElement | undefined;
  class?: string;
}) {
  let overlay!: HTMLDivElement;
  const follow = () => {
    const input = props.input();
    if (input) overlay.scrollLeft = input.scrollLeft;
  };
  const followSoon = () => requestAnimationFrame(follow);

  onMount(() => {
    const input = props.input();
    if (!input) return;

    for (const event of FOLLOW_EVENTS)
      input.addEventListener(event, followSoon);
    onCleanup(() => {
      for (const event of FOLLOW_EVENTS)
        input.removeEventListener(event, followSoon);
    });
  });
  createEffect(on(() => props.parts, followSoon));

  return (
    <div
      ref={overlay}
      aria-hidden="true"
      class={cn(
        'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre',
        props.class
      )}
    >
      <SearchOperatorText parts={props.parts} />
    </div>
  );
}
