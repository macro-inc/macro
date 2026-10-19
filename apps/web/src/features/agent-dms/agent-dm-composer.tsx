import { AgentConversationControls } from '@app/features/agent-conversations/agent-conversation-controls';
import { useAgentConversations } from '@app/features/agent-conversations/queries/conversations';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import { createMemo, type ParentProps, Show } from 'solid-js';
import { ConversationNotice } from './components/conversation-notice';

/**
 * App-facing composition; `botId` names the persona when the channel is an
 * agent DM, and the composer is the channel's own otherwise.
 *
 * The input is the same element either way, so a DM whose metadata names its
 * agent only after the channel first rendered keeps the input the user may
 * already be typing in.
 */
export function AgentDmComposer(
  props: ParentProps<{ channelId: string; botId: string | undefined }>
) {
  const conversations = useAgentConversations(
    () => props.channelId,
    () => props.botId !== undefined
  );
  // A failed poll keeps the last answer, so the composer stays mounted; only
  // a conversation that never loaded shows the error.
  const conversation = () =>
    props.botId !== undefined && queryReadyGate(conversations)
      ? conversations.data.find(
          (conversation) => conversation.botId === props.botId
        )
      : undefined;
  // A DM offers its input once the conversation says the agent is available.
  // An input already on screen stays until the conversation says it is not.
  const inputShown = createMemo<boolean>((shown) => {
    if (props.botId === undefined) return true;
    if (queryReadyGate(conversations))
      return conversation()?.available === true;
    return shown;
  }, false);
  const notice = () =>
    queryReadyGate(conversations)
      ? 'unavailable'
      : conversations.isError
        ? 'error'
        : 'loading';
  // In a DM, centered in the message column like the channel input it wraps:
  // the input sizes itself to that column, and the controls and notices share
  // its edges. Elsewhere the wrapper makes no box of its own.
  return (
    <div
      class={
        props.botId === undefined
          ? 'contents'
          : 'flex w-full min-w-0 flex-col items-center'
      }
    >
      <Show when={conversation()}>
        {(data) => (
          <div class="macro-message-width">
            <AgentConversationControls
              conversation={data()}
              onChanged={() =>
                fireAndForget(conversations.refetch(), 'agent-dms')
              }
            />
          </div>
        )}
      </Show>
      <Show
        when={inputShown()}
        fallback={
          <div class="macro-message-width">
            <ConversationNotice
              state={notice()}
              onRetry={() =>
                fireAndForget(conversations.refetch(), 'agent-dms')
              }
            />
          </div>
        }
      >
        {props.children}
      </Show>
    </div>
  );
}
