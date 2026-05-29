import { useUserId } from '@core/context/user';
import { useDeleteMessageMutation } from '@queries/channel/message';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { createSignal, Show } from 'solid-js';
import { createChannelMessageActions } from '../Channel/create-channel-message-actions';
import type { InputHandle, InputSnapshot } from '../Input';
import { Thread } from '../Thread';
import { buildQuoteReplyValue } from '../Thread/utils/message-actions';
import { useStandaloneThread } from './context';
import { StandaloneThread } from './StandaloneThread';

type EditableThreadProps = {
  channelId: string;
  messageId: string;
  data?: ApiChannelMessage;
};

function EditableThreadInner() {
  const ctx = useStandaloneThread();
  const userId = useUserId();
  const [replyInputState, setReplyInputState] = createSignal<
    InputSnapshot | undefined
  >();
  const [replyInputHandle, setReplyInputHandle] = createSignal<
    InputHandle | undefined
  >();
  const deleteMessageMutation = useDeleteMessageMutation();
  const addReactionMutation = useAddReactionMutation();
  const removeReactionMutation = useRemoveReactionMutation();

  const getMessageActions = createChannelMessageActions({
    channelId: ctx.channelId,
    userId,
    deleteMessage: deleteMessageMutation.mutate,
    addReaction: addReactionMutation.mutate,
    removeReaction: removeReactionMutation.mutate,
    onReply: ({ message }) => {
      if (message.thread_id) {
        const current = replyInputState();
        const nextSnapshot: InputSnapshot = {
          value: buildQuoteReplyValue({
            quotedContent: message.content,
            existingValue: current?.value,
          }),
          mentions: current?.mentions ?? [],
          attachments: current?.attachments ?? [],
        };
        setReplyInputState(nextSnapshot);
        replyInputHandle()?.restoreSnapshot(nextSnapshot);
      }

      ctx.setIsReplying(true);
    },
  });

  const parentActions = () => {
    const p = ctx.parent();
    return p ? getMessageActions(p) : undefined;
  };

  return (
    <>
      <StandaloneThread.ParentMessage actions={parentActions()} />
      <StandaloneThread.Replies
        getMessageActions={getMessageActions}
        showReplyButton
      />
      <Show when={ctx.isReplying()}>
        <Thread.ReplyInput
          channelId={ctx.channelId()}
          messageId={ctx.messageId()}
          replyInputState={replyInputState}
          setReplyInputState={setReplyInputState}
          setIsReplying={ctx.setIsReplying}
          setReplyInputHandle={setReplyInputHandle}
        />
      </Show>
    </>
  );
}

export function EditableThread(props: EditableThreadProps) {
  return (
    <StandaloneThread.Root
      channelId={props.channelId}
      messageId={props.messageId}
      data={props.data}
    >
      <EditableThreadInner />
    </StandaloneThread.Root>
  );
}
