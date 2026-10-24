import { NoticeCard } from '@app/features/agent-cards/components/notice';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  AgentConversation,
  AgentConversationTurn,
} from '@service-agent-harness/agent-conversations';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
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
  // Every poll brings each entry anew. Keyed by the agent answering, a
  // status stays put, and a Retry it has in flight stays disabled.
  return (
    <Key each={answering()} by={(entry) => entry.conversation.botId}>
      {(entry) => (
        <TurnStatus
          conversation={entry().conversation}
          turn={entry().turn}
          onChanged={() =>
            fireAndForget(context.refresh(), 'agent-conversations')
          }
        />
      )}
    </Key>
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
  const retry = (variant: 'cta' | 'outline' | 'ghost') => (
    <Show when={failed() && retryable()}>
      <Button
        size="sm"
        variant={variant}
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate({
            type: 'retry',
            conversation: props.conversation,
            turn: props.turn,
          })
        }
      >
        Retry
      </Button>
    </Show>
  );
  return (
    <div class="ml-14 pb-2">
      <Switch>
        <Match when={props.turn.state === 'failed'}>
          <NoticeCard
            tone="error"
            title="Couldn't finish this"
            detail={
              retryable()
                ? 'Retry runs your message again'
                : 'Anything it already did is above'
            }
            action={retry('cta')}
          />
        </Match>
        <Match when={props.turn.state === 'interrupted'}>
          <NoticeCard
            tone="warning"
            title="Interrupted before it finished"
            detail="Check what it already did before you retry"
            action={retry('outline')}
          />
        </Match>
        <Match when={true}>
          <div
            class="flex items-center gap-3 text-xs text-ink-muted"
            role="status"
          >
            <span>{props.turn.state === 'queued' ? 'Queued' : 'Stopped'}</span>
            {retry('ghost')}
          </div>
        </Match>
      </Switch>
    </div>
  );
}
