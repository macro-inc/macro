import { toast } from '@core/component/Toast/Toast';
import type {
  AgentConversation,
  AgentConversationTurn,
} from '@service-agent-harness/agent-conversations';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { useOptionalAgentConversations } from './context';
import { useAgentConversationControl } from './queries/controls';

/** A context boundary belongs to its first source message, including on reload. */
export function AgentConversationContextBoundary(props: { messageId: string }) {
  const context = useOptionalAgentConversations();
  const startsContext = () =>
    (context?.conversations() ?? []).some((conversation) =>
      conversation.sessions
        .slice(1)
        .some(
          (session) =>
            conversation.turns.find(
              (turn) => turn.sessionId === session.sessionId
            )?.sourceMessageId === props.messageId
        )
    );
  return (
    <Show when={startsContext()}>
      <div
        role="separator"
        class="my-5 flex items-center gap-3 text-xs text-ink-muted"
      >
        <span class="h-px flex-1 bg-edge-muted" />
        Fresh context · earlier messages kept
        <span class="h-px flex-1 bg-edge-muted" />
      </div>
    </Show>
  );
}

const FAILED = ['failed', 'stopped', 'interrupted'];

/**
 * Durable per-message status for each agent answering the message, with an
 * explicit retry of the exact failed attempt.
 */
export function AgentConversationMessageStatus(props: { messageId: string }) {
  const context = useOptionalAgentConversations();
  if (!context) return null;
  const answering = () =>
    (context.conversations() ?? []).flatMap((conversation) => {
      const turn = conversation.turns.find(
        (turn) => turn.sourceMessageId === props.messageId
      );
      return turn && (turn.state === 'queued' || FAILED.includes(turn.state))
        ? [{ conversation, turn }]
        : [];
    });
  return (
    <For each={answering()}>
      {(entry) => (
        <TurnStatus
          conversation={entry.conversation}
          turn={entry.turn}
          onChanged={context.refresh}
        />
      )}
    </For>
  );
}

function TurnStatus(props: {
  conversation: AgentConversation;
  turn: AgentConversationTurn;
  onChanged: () => void;
}) {
  const retryable = () =>
    props.turn.retryable &&
    props.conversation.available &&
    props.conversation.sessions.some(
      (session) =>
        session.isCurrent && session.sessionId === props.turn.sessionId
    );
  const failed = () => FAILED.includes(props.turn.state);
  const mutation = useAgentConversationControl({
    onSuccess: props.onChanged,
    onError: () =>
      toast.failure('Could not retry this message. Refresh and try again.'),
  });
  return (
    <div
      class="ml-14 flex items-center gap-3 pb-2 text-xs text-ink-muted"
      role="status"
    >
      <span>
        {props.turn.state === 'queued'
          ? 'Queued'
          : props.turn.state === 'interrupted'
            ? 'Interrupted. Review completed actions before retrying.'
            : props.turn.state === 'stopped'
              ? 'Stopped'
              : 'Could not finish this message.'}
      </span>
      <Show when={failed() && retryable()}>
        <Button
          size="xs"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              type: 'retry',
              conversation: props.conversation,
              turn: props.turn,
            })
          }
        >
          Retry message
        </Button>
      </Show>
    </div>
  );
}
