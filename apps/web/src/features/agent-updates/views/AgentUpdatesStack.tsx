import { useUserId } from '@core/context/user';
import { NotificationStack } from '@ui';
import { Show } from 'solid-js';
import { AgentUpdateCard } from '../components/AgentUpdateCard';
import type { AgentUpdate, UpdateSession } from '../core/agent-update';
import { createAgentUpdates } from '../primitives/create-agent-updates';

/**
 * Live updates for the given sessions as a notification stack. Hosts supply
 * the sessions (the Agents list, or an AI tool result) and navigation.
 */
export function AgentUpdatesStack(props: {
  sessions: readonly UpdateSession[];
  onOpenSession: (sessionId: string) => void;
  /** Omitted where there is no composer to attach an update to. */
  onChatAbout?: (sessionId: string, sessionName: string) => void;
  /** Leave room for the floating composer on the touch home page. */
  home?: boolean;
}) {
  const ownerId = useUserId();
  const model = createAgentUpdates(() => props.sessions, ownerId);
  return (
    <Show when={model.updates().length > 0}>
      <div
        class="w-full"
        classList={{
          'touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]':
            props.home,
        }}
      >
        <NotificationStack
          label="Updates from coding agents"
          title={
            <>
              <span class="size-2 rounded-full bg-warning" aria-hidden="true" />
              <strong>
                {model.updates().length} updates from coding agents
              </strong>
            </>
          }
          items={model.updates()}
          itemKey={(update) => update.id}
        >
          {(update: AgentUpdate) => (
            <AgentUpdateCard
              update={update}
              answering={model.answering(update)}
              onAnswer={(answer) => model.answer(update, answer)}
              onChatAbout={
                props.onChatAbout
                  ? () =>
                      props.onChatAbout?.(update.sessionId, update.sessionName)
                  : undefined
              }
              onOpenSession={() => props.onOpenSession(update.sessionId)}
            />
          )}
        </NotificationStack>
      </div>
    </Show>
  );
}
