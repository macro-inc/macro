import { AgentConversationControls } from '@app/features/agent-conversations/agent-conversation-controls';
import { useAgentConversations } from '@app/features/agent-conversations/queries/conversations';
import { queryReadyGate } from '@queries/gate';
import { type ParentProps, Show } from 'solid-js';
import { ConversationNotice } from './components/conversation-notice';

/**
 * App-facing composition; `botId` names the persona when the channel is an
 * agent DM, and the composer is the channel's own otherwise.
 */
export function AgentDmComposer(
  props: ParentProps<{ channelId: string; botId: string | undefined }>
) {
  return (
    <Show when={props.botId} fallback={props.children} keyed>
      {(botId) => (
        <AgentDmComposerContent channelId={props.channelId} botId={botId}>
          {props.children}
        </AgentDmComposerContent>
      )}
    </Show>
  );
}

function AgentDmComposerContent(
  props: ParentProps<{ channelId: string; botId: string }>
) {
  const conversations = useAgentConversations(() => props.channelId);
  // A failed poll keeps the last answer, so the composer stays mounted; only
  // a conversation that never loaded shows the error.
  const conversation = () =>
    queryReadyGate(conversations)
      ? conversations.data.find(
          (conversation) => conversation.botId === props.botId
        )
      : undefined;
  const available = () => conversation()?.available === true;
  const notice = () =>
    queryReadyGate(conversations)
      ? 'unavailable'
      : conversations.isError
        ? 'error'
        : 'loading';
  // Centered in the message column, like the channel input it wraps: the
  // input sizes itself to that column, and the controls and notices share
  // its edges.
  return (
    <div class="flex w-full min-w-0 flex-col items-center">
      <Show when={conversation()}>
        {(data) => (
          <div class="macro-message-width">
            <AgentConversationControls
              conversation={data()}
              onChanged={() => void conversations.refetch()}
            />
          </div>
        )}
      </Show>
      <Show
        when={available()}
        fallback={
          <div class="macro-message-width">
            <ConversationNotice
              state={notice()}
              onRetry={() => void conversations.refetch()}
            />
          </div>
        }
      >
        {props.children}
      </Show>
    </div>
  );
}
