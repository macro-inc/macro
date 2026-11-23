import { DisclosureCaret, TextShimmer } from '@app/features/block-agent/ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { ActivityRows, type ActivityRowView } from './activity-rows';

/**
 * A finished run of steps as one line that opens to the steps. The line
 * counts steps only: a step that failed and was retried did not fail the
 * reply, so its failure shows on its own row once the run is open.
 */
export function ActivitySummary(props: { rows: readonly ActivityRowView[] }) {
  const [open, setOpen] = createSignal(false);
  const contentId = createUniqueId();
  const count = () => props.rows.length;
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
          <TextShimmer
            text={`Used ${count()} ${count() === 1 ? 'tool' : 'tools'}`}
            active={running()}
          />
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
