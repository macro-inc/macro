import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { AgentSessionStatus } from './mention-types';
import type { AgentSessionLogEvent } from './realtime-protocol';

/** Follow owner events; newer snapshots supersede older live observations. */
export function createAgentSessionMentionStatus(
  id: Accessor<string | undefined>,
  snapshot: Accessor<
    { status: AgentSessionStatus; updatedAt: number } | undefined
  >,
  subscribe: (
    id: string,
    sink: (event: AgentSessionLogEvent) => void
  ) => () => void
) {
  const [live, setLive] = createSignal<{
    status: AgentSessionStatus;
    updatedAt: number;
  }>();
  createEffect(
    on(id, (sessionId) => {
      setLive(undefined);
      if (!sessionId) return;
      onCleanup(
        subscribe(sessionId, (entry) => {
          const content = entry.content;
          if (
            typeof content !== 'object' ||
            !content ||
            !('type' in content) ||
            content.type !== 'event' ||
            !('event' in content) ||
            typeof content.event !== 'string'
          )
            return;
          setLive({
            status: { kind: 'event', event: content.event },
            updatedAt: Date.now(),
          });
        })
      );
    })
  );
  return () => {
    const seed = snapshot();
    const event = live();
    return event && (!seed || event.updatedAt > seed.updatedAt)
      ? event.status
      : seed?.status;
  };
}
