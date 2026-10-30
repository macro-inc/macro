import List from '@phosphor-icons/core/regular/list.svg';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

export const listAgentUpdatesHandler = createToolRenderer({
  name: 'ListAgentUpdates',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const items = () => ctx.response?.data.items ?? [];
    const status = () => {
      if (!ctx.response) return undefined;
      const count = items().length;
      return count === 0
        ? 'No updates'
        : `${count} update${count === 1 ? '' : 's'}`;
    };

    return (
      <BaseTool
        icon={List}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response && expanded() ? (
            <div class="space-y-2 px-3 py-2">
              <For each={items()}>
                {(item) => (
                  <div class="min-w-0">
                    <div class="truncate text-ink">{item.sessionName}</div>
                    <div class="text-ink-muted">{item.summary}</div>
                  </div>
                )}
              </For>
              <Show when={ctx.response?.data.truncated}>
                <div class="text-ink-muted">
                  {ctx.response?.data.truncationNotice}
                </div>
              </Show>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>Read agent updates</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!ctx.response}
            status={status()}
          />
        </div>
      </BaseTool>
    );
  },
});
