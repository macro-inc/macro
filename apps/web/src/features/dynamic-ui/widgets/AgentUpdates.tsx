import { sessionsOf } from '@app/features/agent-updates/core/agent-update';
import { AgentUpdatesStack } from '@app/features/agent-updates/views/AgentUpdatesStack';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { agentSessionQueryOptions } from '@queries/agent-session/session';
import { useQueries } from '@tanstack/solid-query';
import type { WidgetOf } from '../view';

export type AgentUpdatesProps = Omit<WidgetOf<'agentUpdates'>, 'type'>;

/** The most sessions the server lists; a view never opens more. */
const MAX_SESSIONS = 25;

/**
 * The cards a ListAgentUpdates result draws, for the items an ExecuteCode
 * program read with `macro.agentSessions.updates()`: each waiting session is
 * opened live, so its card answers the current request. The items are the
 * model's, and a view can be posted where others see it, so only sessions the
 * viewer owns, as loaded with the viewer's own access, get a card.
 */
export function AgentUpdates(props: AgentUpdatesProps) {
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  const items = () => props.items.slice(0, MAX_SESSIONS);
  const loaded = useQueries(() => ({
    queries: items().map((item) => agentSessionQueryOptions(item.session.id)),
  }));
  const sessions = () => {
    const viewer = userId();
    const owned = new Map(
      // Read data only once loaded: a pending read suspends the whole view.
      loaded.flatMap((query) =>
        query.isSuccess && query.data.ownerId === viewer
          ? [[query.data.id, query.data] as const]
          : []
      )
    );
    return sessionsOf(
      {
        items: items().map((item) => ({ ...item, sessionId: item.session.id })),
      },
      viewer
    ).flatMap((session) => {
      const real = owned.get(session.id);
      return real
        ? [
            {
              ...session,
              name: real.name,
              harness: real.harness,
              botId: real.botId,
            },
          ]
        : [];
    });
  };
  return (
    <AgentUpdatesStack
      sessions={sessions()}
      onOpenSession={(id) =>
        openWithSplit({ type: 'agent', id }, { activate: true })
      }
    />
  );
}
