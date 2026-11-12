import { sessionsOf } from '@app/features/agent-updates/core/agent-update';
import { AgentUpdatesStack } from '@app/features/agent-updates/views/AgentUpdatesStack';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import type { WidgetOf } from '../view';

export type AgentUpdatesProps = Omit<WidgetOf<'agentUpdates'>, 'type'>;

/**
 * The cards a ListAgentUpdates result draws, for the items an ExecuteCode
 * program read with `macro.agentSessions.updates()`: each waiting session is
 * opened live, so its card answers the current request.
 */
export function AgentUpdates(props: AgentUpdatesProps) {
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  return (
    <AgentUpdatesStack
      sessions={sessionsOf(
        {
          items: props.items.map((item) => ({
            ...item,
            sessionId: item.session.id,
          })),
        },
        userId()
      )}
      onOpenSession={(id) =>
        openWithSplit({ type: 'agent', id }, { activate: true })
      }
    />
  );
}
