import type { UpdateSession } from '@app/features/agent-updates/core/agent-update';
import { AgentUpdatesStack } from '@app/features/agent-updates/views/AgentUpdatesStack';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import List from '@phosphor-icons/core/regular/list.svg';
import type { AgentUpdates } from '@service-cognition/generated/tools/types';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/**
 * One entry per session in the tool result. Waiting sessions are opened live,
 * so their cards show the current request and leave once it is answered.
 */
export function sessionsOf(
  updates: AgentUpdates,
  ownerId: string | undefined
): UpdateSession[] {
  if (!ownerId) return [];
  const sessions = new Map<string, UpdateSession>();
  for (const item of updates.items) {
    if (sessions.has(item.sessionId)) continue;
    sessions.set(item.sessionId, {
      id: item.sessionId,
      name: item.sessionName,
      ownerId,
      isArchived: false,
      harness: item.harness,
      botId: '',
      turnState: item.kind === 'stalled' ? 'running' : 'blocked',
      updatedAt: item.since,
    });
  }
  return [...sessions.values()];
}

export const listAgentUpdatesHandler = createToolRenderer({
  name: 'ListAgentUpdates',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const userId = useUserId();
    const { openWithSplit } = useSplitLayout();
    const items = () => ctx.response?.data.items ?? [];
    const status = () => {
      if (!ctx.response) return undefined;
      const count = items().length;
      return count === 0
        ? 'No updates'
        : `${count} update${count === 1 ? '' : 's'}`;
    };

    return (
      <div class="flex min-w-0 flex-col gap-2">
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
        <Show when={ctx.response?.data}>
          {(data) => (
            <AgentUpdatesStack
              sessions={sessionsOf(data(), userId())}
              onOpenSession={(id) =>
                openWithSplit({ type: 'agent', id }, { activate: true })
              }
            />
          )}
        </Show>
      </div>
    );
  },
});
