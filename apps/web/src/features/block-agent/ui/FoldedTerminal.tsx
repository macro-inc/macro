import { Show } from 'solid-js';
import { FoldedAnsiText } from './FoldedAnsiText';

/** A terminal call's output, ANSI-colored, plus its exit code when it failed. */
export function FoldedTerminal(props: {
  output: string;
  exitCode?: number | null;
}) {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.exitCode != null && props.exitCode !== 0}>
        <span class="text-xs text-failure">Exit code {props.exitCode}</span>
      </Show>
      <pre class="overflow-x-auto rounded bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-ink-muted wrap-break-word">
        <FoldedAnsiText text={props.output} />
      </pre>
    </div>
  );
}
