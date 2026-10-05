import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';

/** A saved answer's question, its state, and the controls to check it. */
export function QuestionDetails(props: {
  prompt: string;
  /** Why the answer is unavailable, in the reader's words. */
  error?: string;
  /** The answer, where the surface around the details does not show it. */
  results?: JSX.Element;
  loading: boolean;
  /** The saved SQL, rendered only when SQL is shown. */
  sql?: () => JSX.Element;
  onRefresh: () => void;
}) {
  return (
    <div class="space-y-3 p-4">
      <p class="text-sm font-medium">{props.prompt || 'Database question'}</p>
      <Show when={props.error}>
        {(error) => (
          <p role="alert" class="text-sm text-failure-ink">
            {error()}
          </p>
        )}
      </Show>
      {props.results}
      <Show when={props.loading}>
        <p role="status" class="text-sm text-ink-muted">
          Finding your answer…
        </p>
      </Show>
      <Show when={props.sql}>
        {(sql) => (
          <details class="text-xs">
            <summary class="text-ink-muted">View SQL</summary>
            <pre class="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-input p-2">
              {sql()()}
            </pre>
          </details>
        )}
      </Show>
      <div class="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => props.onRefresh()}
          disabled={props.loading}
        >
          <ArrowClockwiseIcon class="size-3.5" />
          Refresh
        </Button>
      </div>
    </div>
  );
}
