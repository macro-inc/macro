import { DisclosureCaret, TextShimmer } from '@app/features/block-agent/ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { ActivityRows, type ActivityRowView } from './activity-rows';

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
      <div class="my-1 min-w-0 text-sm">
        <button
          type="button"
          aria-expanded={open()}
          aria-controls={contentId}
          class="group flex min-h-6 items-center gap-1 text-ink-extra-muted touch:min-h-[44px] not-touch:hover:text-ink-muted"
          onClick={() => setOpen(!open())}
        >
          <span>
            <TextShimmer
              text={`Used ${count()} ${count() === 1 ? 'tool' : 'tools'}`}
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
