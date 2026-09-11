/**
 * The tail of an open turn that has produced nothing to read yet.
 *
 * A sibling of `Thought`, deliberately shaped differently. A thought row leads
 * with a caret because there is text behind it; this row has nothing to
 * expand, so the caret gives way to a dot that breathes on the shimmer's own
 * period, and the row is not a control at all.
 *
 * The transcript keeps a caret-width slot so the label does not shift once
 * reasoning arrives and the row becomes a `Thought`. Surfaces without that
 * caret (the channel chip) sit the same dot on the verbs instead.
 */

import { createSignal, onCleanup, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';
import { createVerbDraw, WORKING_LABEL } from './working-verbs';

/**
 * How long a word holds. Faster reads as thrashing rather than work. The first
 * word holds for a full interval too, so the short turns that make up most of
 * a session never show a verb at all.
 */
const HOLD_MS = 4000;

/** How long the crossfade between words runs. */
const SWAP_MS = 180;

export interface WorkingLineProps {
  /**
   * `caret` (default) reserves the thought caret's width. `dot` sits the
   * breathing glyph on the verbs, for surfaces that have no caret to match.
   */
  lead?: 'caret' | 'dot';
}

export function WorkingLine(props: WorkingLineProps) {
  const [verb, setVerb] = createSignal(WORKING_LABEL);
  const [swapping, setSwapping] = createSignal(false);

  const drawVerb = createVerbDraw();
  let swapTimer: ReturnType<typeof setTimeout> | undefined;

  const rotation = setInterval(() => {
    setSwapping(true);
    swapTimer = setTimeout(() => {
      setVerb(drawVerb());
      setSwapping(false);
    }, SWAP_MS);
  }, HOLD_MS);

  onCleanup(() => {
    clearInterval(rotation);
    if (swapTimer !== undefined) clearTimeout(swapTimer);
  });

  const tight = () => props.lead === 'dot';

  return (
    <div
      class="flex items-center gap-1 text-xs leading-5 text-ink-extra-muted"
      classList={{ 'min-h-7 py-1': !tight() }}
      data-agent-working-line
      data-agent-working-lead={tight() ? 'dot' : 'caret'}
    >
      <Show
        when={tight()}
        fallback={
          <span
            aria-hidden="true"
            class="flex size-4 shrink-0 items-center justify-center"
          >
            <span class="agent-working-dot size-[5px] rounded-full bg-current" />
          </span>
        }
      >
        <span
          aria-hidden="true"
          class="agent-working-dot size-[5px] shrink-0 rounded-full bg-current"
        />
      </Show>
      {/* The visible word rotates; the label a screen reader hears does not.
          Narrating a synonym every few seconds is noise, and the one fact
          worth announcing is that the turn is still open. */}
      <TextShimmer
        text={verb()}
        label={WORKING_LABEL}
        active
        class={`transition-opacity duration-200 motion-reduce:transition-none ${
          swapping() ? 'opacity-0' : ''
        }`}
      />
    </div>
  );
}
