import { DisclosureCaret, TextShimmer } from '@app/features/block-agent/ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { ActivityRows, type ActivityRowView } from './activity-rows';

const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

/**
 * What a run did: the model's tool calls, and the SDK requests its code
 * executions made, which are rows of their own but not calls.
 */
export function usedLabel(rows: readonly ActivityRowView[]): string {
  const calls = new Set(rows.map((row) => row.call ?? row.id)).size;
  const requests = rows.filter((row) => row.call).length;
  const used = `Used ${plural(calls, 'tool')}`;
  return requests > 0 ? `${used} · ${plural(requests, 'request')}` : used;
}

/**
 * A finished run of steps as one line that opens to the steps. Failed steps
 * are counted on the line, so folding the run never hides that one failed.
 */
export function ActivitySummary(props: { rows: readonly ActivityRowView[] }) {
  const [open, setOpen] = createSignal(false);
  const contentId = createUniqueId();
  const count = () => props.rows.length;
  const failed = () =>
    props.rows.filter((row) => row.status === 'failed').length;
  // A call held for permission can still finish after its run sealed.
  const running = () => props.rows.some((row) => row.status === 'running');
  return (
    <Show when={count() > 0}>
      <div class="my-1 min-w-0">
        <button
          type="button"
          aria-expanded={open()}
          aria-controls={contentId}
          class="group flex min-h-6 items-center gap-1 text-ink-extra-muted touch:min-h-[44px] not-touch:hover:text-ink-muted"
          onClick={() => setOpen(!open())}
        >
          <span>
            <TextShimmer
              text={usedLabel(props.rows)}
              active={running()}
            />
            <Show when={failed() > 0}>
              <span class="text-failure">{` · ${failed()} failed`}</span>
            </Show>
          </span>
          <DisclosureCaret open={open()} />
        </button>
        <CollapseTransition open={open()}>
          <div id={contentId}>
            <ActivityRows rows={props.rows} />
          </div>
        </CollapseTransition>
      </div>
    </Show>
  );
}
