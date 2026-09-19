import { createEffect, createSignal, on, Show } from 'solid-js';
import { FoldedAnsiText } from './FoldedAnsiText';

/**
 * How close to the bottom (in px) the reader has to be for new output to
 * keep the view pinned there. Anything further up is a reader who scrolled
 * back to look at something, and must not be yanked away from it.
 */
const FOLLOW_THRESHOLD_PX = 24;

/**
 * A terminal call's output, ANSI-colored, plus its exit code when it failed.
 *
 * Output streams in while the command runs - the fold appends each write as
 * the harness reports it - so the body is bounded in height and follows the
 * tail the way a terminal does, until the reader scrolls up to read
 * something earlier. A running command ends in a caret so a quiet stretch
 * reads as "still going" rather than "done".
 */
export function FoldedTerminal(props: {
  output: string;
  exitCode?: number | null;
  /** The command is still running: follow new output and show the caret. */
  active?: boolean;
}) {
  let scroller: HTMLPreElement | undefined;
  const [following, setFollowing] = createSignal(true);

  const nearBottom = (element: HTMLElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    FOLLOW_THRESHOLD_PX;

  // Syncing scroll position with the DOM is what effects are for: the
  // output grew, so the viewport moves - only while the reader was already
  // at the tail and the command is still producing.
  createEffect(
    on(
      () => props.output,
      () => {
        if (!scroller || !props.active || !following()) return;
        scroller.scrollTop = scroller.scrollHeight;
      }
    )
  );

  return (
    <div class="flex flex-col gap-1">
      <Show when={props.exitCode != null && props.exitCode !== 0}>
        <span class="text-xs text-failure">Exit code {props.exitCode}</span>
      </Show>
      <pre
        ref={scroller}
        class="max-h-80 overflow-auto rounded bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-ink-muted wrap-break-word"
        data-following={String(following())}
        onScroll={(event) => setFollowing(nearBottom(event.currentTarget))}
      >
        <FoldedAnsiText text={props.output} />
        <Show when={props.active}>
          <span
            aria-hidden="true"
            class="inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-ink-muted motion-reduce:animate-none"
          />
        </Show>
      </pre>
    </div>
  );
}
