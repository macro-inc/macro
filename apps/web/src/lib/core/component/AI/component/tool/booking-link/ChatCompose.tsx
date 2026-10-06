import type { BookingLinkArgs } from '@app/features/scheduling/core/booking-link';
import {
  executeBookingReview,
  invalidateBookingLinks,
  persistBookingReview,
  rejectBookingReview,
} from '@app/features/scheduling/queries/booking-link-review';
import { useChatContext } from '@core/component/AI/context';
import { toast } from '@core/component/Toast/Toast';
import { useChatQuery } from '@queries/chat';
import { deserializeToolResponse } from '@service-cognition/generated/tools/tool';
import { debounce } from '@solid-primitives/scheduled';
import type { UserToolReviewSink } from '../user-tool-review';
import { BookingDraftComposer } from './DraftComposer';

/** Chat persists drafts and finishes the existing deferred tool call. */
export function BookingChatCompose(props: {
  chatId: string;
  messageId: string;
  toolCallId: string;
  name: 'CreateBookingLink' | 'EditBookingLink';
  initialData: BookingLinkArgs;
  streamLocked: boolean;
}) {
  const chat = useChatContext();
  const query = useChatQuery(() => props.chatId);
  const canAct = () =>
    query.isSuccess &&
    query.data.userAccessLevel === 'owner' &&
    !props.streamLocked;
  const identity = () => ({
    chat_id: props.chatId,
    messageId: props.messageId,
    toolCallId: props.toolCallId,
  });
  let latest: BookingLinkArgs | undefined;
  let queue = Promise.resolve();
  let finalized = false;
  const persist = () => {
    const args = latest;
    if (!args || finalized) return;
    const previous = queue;
    queue = (async () => {
      await previous;
      if (finalized) return;
      try {
        const result = await persistBookingReview(identity(), args);
        if (result.isErr()) toast.failure('Could not save booking draft');
      } catch {
        toast.failure('Could not save booking draft');
      }
    })();
  };
  const deferredPersist = debounce(persist, 200);
  function updateResponse(response: unknown, args?: BookingLinkArgs) {
    chat.setMessages((messages) =>
      messages.map((message) => {
        if (message.id !== props.messageId || !Array.isArray(message.content))
          return message;
        return {
          ...message,
          content: message.content.map((part) => {
            if (
              part.type === 'toolCallResponseJson' &&
              part.id === props.toolCallId
            )
              return { ...part, json: response };
            if (
              args &&
              part.type === 'toolCall' &&
              part.id === props.toolCallId
            )
              return { ...part, json: args };
            return part;
          }),
        };
      })
    );
  }
  const sink: UserToolReviewSink<BookingLinkArgs> = {
    canAct,
    lockedNotice: () =>
      props.streamLocked
        ? 'Waiting for the response to finish.'
        : query.isSuccess && query.data.userAccessLevel !== 'owner'
          ? 'Only the chat owner can finish this booking link.'
          : undefined,
    onEdit: (args) => {
      latest = args;
      deferredPersist();
    },
    onExecute: async (args) => {
      deferredPersist.clear();
      await queue;
      const result = await executeBookingReview(identity(), args);
      if (result.isErr())
        throw new Error('Could not save the booking link. Please try again.');
      const response = result.value;
      // Validate the result with the generated contract before presenting a saved link.
      const parsed = deserializeToolResponse({
        id: props.toolCallId,
        name: props.name,
        json: response,
      });
      if (
        parsed.isErr() ||
        typeof response !== 'object' ||
        response === null ||
        !('UserAction' in response)
      ) {
        const message =
          typeof response === 'object' &&
          response !== null &&
          'error' in response &&
          typeof response.error === 'string'
            ? response.error
            : 'The booking link was not saved. Please try again.';
        throw new Error(message);
      }
      finalized = true;
      updateResponse(response, args);
      void invalidateBookingLinks();
      return true;
    },
    onReject: async () => {
      deferredPersist.clear();
      await queue;
      const result = await rejectBookingReview(identity());
      if (result.isErr())
        throw new Error('Could not cancel the review. Please try again.');
      finalized = true;
      updateResponse('Rejected');
      return true;
    },
    onDispose: () => {
      deferredPersist.clear();
      if (!finalized) persist();
    },
  };
  return <BookingDraftComposer initialData={props.initialData} sink={sink} />;
}
