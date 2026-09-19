/**
 * A running summary line like "3 files read, 2 searches": each count rolls
 * via {@link AnimatedNumber}, items slide in/out as their counts hit zero, and
 * plural suffixes ("search" → "searches") animate where the words allow it.
 *
 * Ported from opencode's `tool-count-summary.tsx` (`AnimatedCountList`) and
 * `tool-count-label.tsx` (`AnimatedCountLabel`) (github.com/sst/opencode,
 * MIT © 2025 opencode). The original `{{count}}` template interpolation is
 * simplified to `${count} ${count === 1 ? one : other}` composition, and the
 * CSS files are replaced with Tailwind utilities.
 */
import { createMemo, Index, Show } from 'solid-js';
import { AnimatedNumber } from './AnimatedNumber';

/** One countable thing, with its singular and plural labels. */
export interface CountItem {
  /** Stable identity for the item across re-renders. */
  key: string;
  count: number;
  /** Label when count is exactly 1, e.g. "file read". */
  one: string;
  /** Label otherwise, e.g. "files read". */
  other: string;
}

const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]';

/** Grid-column reveal: width, opacity, blur, and a small settle transform. */
const REVEAL =
  `inline-grid origin-left translate-y-[0.06em] scale-[0.985] items-baseline overflow-hidden opacity-0 blur-[2px] [grid-template-columns:0fr] transition-[grid-template-columns,opacity,filter,transform] duration-300 ${EASE} ` +
  'data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:blur-none data-[active=true]:[grid-template-columns:1fr] motion-reduce:transition-none';

/** The ", " between visible items, revealed by max-width. */
const SEPARATOR =
  'inline-flex max-w-0 -translate-x-[0.08em] items-baseline overflow-hidden opacity-0 transition-[max-width,margin,opacity,transform] duration-200 ease-out ' +
  'data-[active=true]:mr-[0.45ch] data-[active=true]:max-w-[1ch] data-[active=true]:translate-x-0 data-[active=true]:opacity-100 motion-reduce:transition-none';

/** The animated plural suffix inside a label. */
const SUFFIX =
  `inline-grid -translate-x-[0.04em] overflow-hidden opacity-0 blur-[1px] [grid-template-columns:0fr] transition-[grid-template-columns,opacity,filter,transform] duration-[250ms] ${EASE} ` +
  'data-[active=true]:translate-x-0 data-[active=true]:opacity-100 data-[active=true]:blur-none data-[active=true]:[grid-template-columns:1fr] motion-reduce:transition-none';

/** Split two labels into their shared stem and the diverging tails. */
function splitWords(one: string, other: string) {
  const a = Array.from(one);
  const b = Array.from(other);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return {
    stem: a.slice(0, i).join(''),
    oneTail: a.slice(i).join(''),
    otherTail: b.slice(i).join(''),
  };
}

/**
 * "3 searches" with the count rolling and, when one label is a prefix of the
 * other, the extra letters sliding in and out on pluralization. Labels that
 * diverge mid-word ("file read" / "files read") swap without animating.
 */
function CountLabel(props: { count: number; one: string; other: string }) {
  const singular = createMemo(() => Math.round(props.count) === 1);
  const parts = createMemo(() => splitWords(props.one, props.other));
  const animatable = createMemo(
    () => parts().oneTail === '' || parts().otherTail === ''
  );
  // The one non-empty tail (constant text, so it can animate out gracefully).
  const tail = createMemo(() => parts().oneTail || parts().otherTail);
  const showTail = createMemo(() =>
    singular() ? parts().oneTail !== '' : parts().otherTail !== ''
  );

  return (
    <span class="inline-flex items-baseline whitespace-pre">
      <AnimatedNumber value={props.count} />
      <Show
        when={animatable()}
        fallback={
          <span class="whitespace-pre">{` ${
            singular() ? props.one : props.other
          }`}</span>
        }
      >
        <span class="whitespace-pre">{` ${parts().stem}`}</span>
        <span class={SUFFIX} data-active={showTail() ? 'true' : 'false'}>
          <span class="min-w-0 overflow-hidden whitespace-pre">{tail()}</span>
        </span>
      </Show>
    </span>
  );
}

/**
 * The summary line. Items with a zero count collapse away (they stay mounted
 * so they can animate back in); when nothing is visible the `fallback` text
 * shows instead.
 */
export function CountSummary(props: {
  items: CountItem[];
  fallback?: string;
  class?: string;
}) {
  const fallback = createMemo(() => props.fallback ?? '');
  const showEmpty = createMemo(
    () => props.items.every((item) => item.count <= 0) && fallback().length > 0
  );

  return (
    <span
      class={`inline-flex items-baseline whitespace-nowrap ${props.class ?? ''}`}
    >
      <span class={REVEAL} data-active={showEmpty() ? 'true' : 'false'}>
        <span class="min-w-0 overflow-hidden whitespace-nowrap">
          {fallback()}
        </span>
      </span>

      <Index each={props.items}>
        {(item, index) => {
          const active = createMemo(() => item().count > 0);
          const hasPrev = createMemo(() => {
            for (let i = index - 1; i >= 0; i--) {
              if (props.items[i].count > 0) return true;
            }
            return false;
          });

          return (
            <>
              <span
                class={SEPARATOR}
                data-active={active() && hasPrev() ? 'true' : 'false'}
              >
                ,
              </span>
              <span class={REVEAL} data-active={active() ? 'true' : 'false'}>
                <span class="inline-flex min-w-0 items-baseline overflow-hidden whitespace-nowrap">
                  <CountLabel
                    one={item().one}
                    other={item().other}
                    count={Math.max(0, Math.round(item().count))}
                  />
                </span>
              </span>
            </>
          );
        }}
      </Index>
    </span>
  );
}
