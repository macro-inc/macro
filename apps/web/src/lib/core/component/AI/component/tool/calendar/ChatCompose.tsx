/**
 * Chat's half of a deferred `CreateCalendarEvent`: the composer over the
 * pending call, finished through the cognition tool endpoints.
 *
 * Edits are persisted as they happen (`updateToolCall`) so a reload keeps
 * them; Create runs the call (`callTool`) and Cancel rejects it
 * (`rejectToolCall`), and either writes the outcome back into the chat's
 * message so the card re-renders as the finished tool.
 */

import { useChatContext } from '@core/component/AI/context';
import type { AssistantMessagePart } from '@core/component/AI/types';
import { toast } from '@core/component/Toast/Toast';
import { invalidateCalendarOccurrences } from '@queries/calendar/occurrences';
import { useChatQuery } from '@queries/chat';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { debounce } from '@solid-primitives/scheduled';
import type { UserToolReviewSink } from '../user-tool-review';
import { CalendarDraftComposer } from './DraftComposer';
import { openToolCalendarEvent } from './open-tool-event';

type CreateCalendarEventResponse = NamedTool<
  'CreateCalendarEvent',
  'response'
>['data'];
type ToolCalendarEvent = Extract<
  CreateCalendarEventResponse,
  { UserAction: unknown }
>['UserAction'];

type CalendarChatComposeProps = {
  chatId: string;
  messageId: string;
  toolCallId: string;
  initialData: CreateCalendarEvent;
  streamLocked?: boolean;
};

function createdEvent(response: unknown): ToolCalendarEvent | undefined {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('UserAction' in response) ||
    typeof response.UserAction !== 'object' ||
    response.UserAction === null ||
    !('eventId' in response.UserAction) ||
    typeof response.UserAction.eventId !== 'string'
  ) {
    return undefined;
  }
  return response.UserAction as ToolCalendarEvent;
}

function toolError(response: unknown) {
  if (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof response.error === 'string'
  ) {
    return response.error;
  }
  return undefined;
}

function updateToolParts(
  parts: AssistantMessagePart[],
  toolCallId: string,
  response: CreateCalendarEventResponse,
  args?: CreateCalendarEvent
) {
  let changed = false;
  const nextParts = parts.map((part) => {
    if (args && part.type === 'toolCall' && part.id === toolCallId) {
      changed = true;
      return { ...part, json: args };
    }
    if (part.type === 'toolCallResponseJson' && part.id === toolCallId) {
      changed = true;
      return { ...part, json: response };
    }
    return part;
  });
  return changed ? nextParts : parts;
}

/** Inline editor for a deferred CreateCalendarEvent tool call in a chat. */
export function CalendarChatCompose(props: CalendarChatComposeProps) {
  const chat = useChatContext();
  const chatQuery = useChatQuery(() => props.chatId);

  const isOwner = () => chatQuery.data?.userAccessLevel === 'owner';
  const ownerKnown = () => chatQuery.isSuccess;
  const canAct = () => ownerKnown() && isOwner() && props.streamLocked !== true;
  const lockedNotice = () => {
    if (ownerKnown() && !isOwner()) {
      return 'Only the chat owner can create or edit this calendar event.';
    }
    if (props.streamLocked) {
      return 'Waiting for the response to finish before this event can be edited.';
    }
    return undefined;
  };

  // Edits go to the server debounced and in order, so the stored call is what
  // the user last saw even if they reload before confirming.
  let lastPersistedSnapshot = JSON.stringify(props.initialData);
  let lastEnqueuedSnapshot = lastPersistedSnapshot;
  let latestArgs: CreateCalendarEvent | undefined;
  let persistenceQueue = Promise.resolve();
  let finalized = false;

  function enqueueUpdate() {
    const args = latestArgs;
    if (finalized || !args) return persistenceQueue;
    const snapshot = JSON.stringify(args);
    if (snapshot === lastEnqueuedSnapshot) return persistenceQueue;
    lastEnqueuedSnapshot = snapshot;

    persistenceQueue = persistenceQueue.then(async () => {
      if (finalized) return;
      try {
        const result =
          await cognitionApiServiceClient.updateToolCall<'CreateCalendarEvent'>(
            {
              chat_id: props.chatId,
              messageId: props.messageId,
              toolCallId: props.toolCallId,
              args,
            }
          );
        if (result.isOk()) {
          lastPersistedSnapshot = snapshot;
          return;
        }
      } catch {
        // Keep the queue usable so a later edit or confirmation can retry.
      }
      if (lastEnqueuedSnapshot === snapshot) {
        lastEnqueuedSnapshot = lastPersistedSnapshot;
      }
      toast.failure('Failed to save calendar event changes');
    });
    return persistenceQueue;
  }
  const debouncedUpdate = debounce(() => void enqueueUpdate(), 150);

  function updateLocalResponse(
    response: CreateCalendarEventResponse,
    args?: CreateCalendarEvent
  ) {
    chat.setMessages((messages) =>
      messages.map((message) => {
        if (message.id !== props.messageId || !Array.isArray(message.content)) {
          return message;
        }
        const content = updateToolParts(
          message.content,
          props.toolCallId,
          response,
          args
        );
        return content === message.content ? message : { ...message, content };
      })
    );
  }

  const sink: UserToolReviewSink<CreateCalendarEvent> = {
    canAct,
    lockedNotice,
    onEdit: (args) => {
      latestArgs = args;
      debouncedUpdate();
    },
    onExecute: async (args) => {
      debouncedUpdate.clear();
      await persistenceQueue;
      const result =
        await cognitionApiServiceClient.callTool<'CreateCalendarEvent'>({
          chat_id: props.chatId,
          messageId: props.messageId,
          toolCallId: props.toolCallId,
          args,
        });
      if (result.isErr()) {
        toast.failure('Failed to create calendar event');
        return false;
      }
      const event = createdEvent(result.value);
      if (!event) {
        toast.failure('Failed to create calendar event', {
          subtext: toolError(result.value),
        });
        return false;
      }
      finalized = true;
      updateLocalResponse(result.value as CreateCalendarEventResponse, args);
      void invalidateCalendarOccurrences();
      toast.success('Calendar event created', {
        actions: [
          { label: 'Open', onClick: () => openToolCalendarEvent(event) },
        ],
      });
      return true;
    },
    onReject: async () => {
      debouncedUpdate.clear();
      await persistenceQueue;
      const result = await cognitionApiServiceClient.rejectToolCall({
        chat_id: props.chatId,
        messageId: props.messageId,
        toolCallId: props.toolCallId,
      });
      if (result.isErr()) {
        toast.failure('Failed to cancel calendar event');
        return false;
      }
      finalized = true;
      updateLocalResponse('Rejected');
      return true;
    },
    onDispose: () => debouncedUpdate.clear(),
  };

  return (
    <CalendarDraftComposer
      initialData={props.initialData}
      sink={sink}
      previewKey={props.toolCallId}
    />
  );
}
