import { toast } from '@core/component/Toast/Toast';
import type { AgentConversation } from '@service-agent-harness/agent-conversations';
import { ConversationActivity } from './components/conversation-activity';
import { useOptionalAgentConversations } from './context';
import { useAgentConversationControl } from './queries/controls';

/**
 * What waits in the conversation's current session and how its last attempt
 * ended, independent of the agent block. A running turn is stopped from the
 * agent's typing row, where it shows.
 */
export function AgentConversationControls(props: {
  conversation: AgentConversation;
  onChanged: () => void;
}) {
  const context = useOptionalAgentConversations();
  const current = () =>
    props.conversation.sessions?.find((session) => session.isCurrent)
      ?.sessionId;
  const turns = () =>
    (props.conversation.turns ?? []).filter(
      (turn) => turn.sessionId === current()
    );
  const running = () => turns().find((turn) => turn.state === 'running');
  const queued = () => turns().filter((turn) => turn.state === 'queued').length;
  const failed = () =>
    turns().findLast(
      (turn) =>
        turn.state === 'failed' ||
        turn.state === 'stopped' ||
        turn.state === 'interrupted'
    );
  const mutation = useAgentConversationControl({
    onSuccess: props.onChanged,
    onError: () =>
      toast.failure(
        'Could not update this conversation. Refresh and try again.'
      ),
  });
  const failure = () => {
    const state = failed()?.state;
    return state === 'failed' || state === 'stopped' || state === 'interrupted'
      ? state
      : undefined;
  };
  return (
    <ConversationActivity
      queued={queued()}
      failed={context || running() ? undefined : failure()}
      canRetry={props.conversation.available}
      pending={mutation.isPending}
      onRetry={() => {
        const turn = failed();
        if (turn)
          mutation.mutate({
            type: 'retry',
            conversation: props.conversation,
            turn,
          });
      }}
    />
  );
}
