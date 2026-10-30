import { useUserId } from '@core/context/user';
import type { AgentSessionEntity } from '@entity';
import { NotificationStack } from '@ui';
import { type Accessor, Show } from 'solid-js';
import { AgentUpdateCard } from '../components/AgentUpdateCard';
import type { AgentUpdate, UpdateSession } from '../core/agent-update';
import { createAgentUpdates } from '../primitives/create-agent-updates';

type Callbacks = {
  onOpenSession: (sessionId: string) => void;
  onChatAbout: (sessionId: string, sessionName: string) => void;
};

function Updates(
  props: {
    sessions: Accessor<readonly UpdateSession[]>;
    home?: boolean;
  } & Callbacks
) {
  const ownerId = useUserId();
  const model = createAgentUpdates(props.sessions, ownerId);
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
              onChatAbout={() =>
                props.onChatAbout(update.sessionId, update.sessionName)
              }
              onOpenSession={() => props.onOpenSession(update.sessionId)}
            />
          )}
        </NotificationStack>
      </div>
    </Show>
  );
}

/** Home view, backed by the existing Agents session list. */
export function AgentUpdatesStack(
  props: {
    sessions: readonly AgentSessionEntity[];
  } & Callbacks
) {
  return (
    <Updates
      sessions={() => props.sessions}
      home
      onOpenSession={props.onOpenSession}
      onChatAbout={props.onChatAbout}
    />
  );
}

/** A single live session's updates for embedded surfaces. */
export function AgentSessionUpdates(
  props: {
    sessionId: string;
    sessionName: string;
    /** Current entity state from the host's session source. */
    session: Pick<
      UpdateSession,
      'ownerId' | 'botId' | 'harness' | 'turnState' | 'isArchived' | 'updatedAt'
    >;
  } & Callbacks
) {
  const session = (): UpdateSession => ({
    ...props.session,
    id: props.sessionId,
    name: props.sessionName,
  });
  return (
    <Updates
      sessions={() => [session()]}
      onOpenSession={props.onOpenSession}
      onChatAbout={props.onChatAbout}
    />
  );
}
