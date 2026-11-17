import { t } from '@app/lib/i18n';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { WorkItem, WorkItemState } from '../core/work-item';

function WorkDot(props: { state: WorkItemState }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'size-1.5 shrink-0 rounded-full',
        props.state === 'running' && 'bg-accent motion-safe:animate-pulse',
        props.state === 'needs_input' && 'bg-warning',
        props.state === 'failed' && 'bg-failure',
        props.state === 'idle' && 'bg-ink-disabled'
      )}
    />
  );
}

function stateLabel(state: WorkItemState) {
  if (state === 'needs_input') return t('agentWork.needsInput');
  if (state === 'failed') return t('agentWork.failed');
  return undefined;
}

/** The sessions an account is working on. Rows never reorder as state changes. */
export function WorkList(props: {
  items: readonly WorkItem[];
  onOpen: (item: WorkItem, event: MouseEvent) => void;
}) {
  return (
    <For each={props.items}>
      {(item) => (
        <button
          type="button"
          class="flex h-8 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-lg px-2 text-left text-sm text-ink outline-none not-touch:hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent touch:h-11"
          onClick={(event) => props.onOpen(item, event)}
        >
          <WorkDot state={item.state} />
          <span class="min-w-0 flex-1 truncate">{item.title}</span>
          <Show when={item.pullRequestNumber}>
            {(number) => (
              <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted tabular-nums">
                <GitPullRequestIcon class="size-3.5" />#{number()}
              </span>
            )}
          </Show>
          <Show when={stateLabel(item.state)}>
            {(label) => (
              <span class="shrink-0 text-xs font-medium text-ink">
                {label()}
              </span>
            )}
          </Show>
        </button>
      )}
    </For>
  );
}
