/**
 * An animated swap between an in-progress title ("Running command…",
 * shimmering) and its finished form ("Ran command") when `active` flips.
 * When the two share a prefix of at least two characters, only the differing
 * suffix morphs.
 *
 * Ported from opencode's
 * `packages/session-ui/src/components/tool-status-title.tsx`
 * (github.com/sst/opencode, MIT © 2025 opencode). The spring width animation
 * is replaced with a plain CSS width transition, and the blur/translate
 * flourishes are dropped in favor of a simple opacity crossfade.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { TextShimmer } from './TextShimmer';

/** Grace period before the width lock is released and text flows naturally. */
const SETTLE_MS = 400;

/** Split two strings into their shared prefix and the differing tails. */
function commonPrefix(active: string, done: string) {
  const a = Array.from(active);
  const b = Array.from(done);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return {
    prefix: a.slice(0, i).join(''),
    activeTail: a.slice(i).join(''),
    doneTail: b.slice(i).join(''),
  };
}

function measure(el: HTMLSpanElement | undefined): string | undefined {
  if (!el) return undefined;
  return `${Math.ceil(el.getBoundingClientRect().width)}px`;
}

export interface ToolStatusTitleProps {
  active: boolean;
  activeText: string;
  doneText: string;
  class?: string;
}

export function ToolStatusTitle(props: ToolStatusTitleProps) {
  const split = createMemo(() =>
    commonPrefix(props.activeText, props.doneText)
  );
  const useSuffix = createMemo(
    () =>
      split().prefix.length >= 2 &&
      split().activeTail.length > 0 &&
      split().doneTail.length > 0
  );
  const activeTail = createMemo(() =>
    useSuffix() ? split().activeTail : props.activeText
  );
  const doneTail = createMemo(() =>
    useSuffix() ? split().doneTail : props.doneText
  );

  // What's currently displayed; trails props.active by one effect run so the
  // outgoing width can be measured before the swap.
  const [shown, setShown] = createSignal(props.active);
  const [animating, setAnimating] = createSignal(false);
  const [width, setWidth] = createSignal<string | undefined>(undefined);

  let tailRef: HTMLSpanElement | undefined;
  let activeRef: HTMLSpanElement | undefined;
  let doneRef: HTMLSpanElement | undefined;
  let frame: number | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (settle !== undefined) clearTimeout(settle);
    frame = undefined;
    settle = undefined;
    setAnimating(false);
    setWidth(undefined);
  };

  createEffect(
    on(
      [() => props.active, activeTail, doneTail],
      ([next]) => {
        const from = measure(tailRef);
        finish();
        setShown(next);
        if (!from) return;
        setAnimating(true);
        setWidth(from);
        frame = requestAnimationFrame(() => {
          frame = undefined;
          const to = measure(next ? activeRef : doneRef);
          if (!to) {
            finish();
            return;
          }
          setWidth(to);
          settle = setTimeout(finish, SETTLE_MS);
        });
      },
      { defer: true }
    )
  );

  onCleanup(finish);

  return (
    <span
      class={`inline-flex items-baseline whitespace-nowrap ${props.class ?? ''}`}
      aria-label={props.active ? props.activeText : props.doneText}
    >
      <Show when={useSuffix()}>
        <span class="shrink-0 whitespace-pre">
          <TextShimmer text={split().prefix} active={shown()} />
        </span>
      </Show>
      <span
        ref={tailRef}
        class="inline-grid justify-items-start overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: width() }}
      >
        <Show when={animating() || shown()}>
          <span
            ref={activeRef}
            class="col-start-1 row-start-1 whitespace-pre transition-opacity duration-200 motion-reduce:transition-none"
            classList={{ 'opacity-0': !shown() }}
          >
            <TextShimmer text={activeTail()} active={shown()} />
          </span>
        </Show>
        <Show when={animating() || !shown()}>
          <span
            ref={doneRef}
            class="col-start-1 row-start-1 whitespace-pre transition-opacity duration-200 motion-reduce:transition-none"
            classList={{ 'opacity-0': shown() }}
          >
            {doneTail()}
          </span>
        </Show>
      </span>
    </span>
  );
}
