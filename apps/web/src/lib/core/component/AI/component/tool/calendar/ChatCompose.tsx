import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import type { EventEditorSubmitValues } from '@app/features/calendar/components/composer/event-form-model';
import { DEFAULT_CALENDAR_SOURCE } from '@app/features/calendar/types';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '@app/features/calendar/utils/calendar-label';
import { useChatContext } from '@core/component/AI/context';
import type { AssistantMessagePart } from '@core/component/AI/types';
import { toast } from '@core/component/Toast/Toast';
import { recipientEntityMapper, useContacts } from '@core/user';
import AirplaneTiltIcon from '@phosphor/airplane-tilt.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { invalidateCalendarOccurrences } from '@queries/calendar/occurrences';
import { useChatQuery } from '@queries/chat';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { debounce } from '@solid-primitives/scheduled';
import { Layer } from '@ui';
import {
  createMemo,
  createSignal,
  ErrorBoundary,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { CalendarToolEventPreview } from './EventPreview';
import {
  createCalendarEventToEditorInitialValues,
  editorSubmitValuesToCreateCalendarEvent,
  outOfOfficeNotice,
} from './event-form-adapter';
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

function CalendarChatComposeFallback() {
  return (
    <Layer depth={2}>
      <div
        role="status"
        aria-label="Loading calendar editor"
        aria-busy="true"
        class="flex min-h-64 animate-pulse flex-col gap-6 rounded-xl border border-edge-muted bg-surface p-4 shadow-sm"
      >
        <span class="sr-only">Loading calendar editor</span>

        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <div class="h-7 w-28 rounded-lg bg-skeleton" />
            <div class="h-7 w-28 rounded-lg bg-skeleton" />
            <div class="h-7 w-16 rounded-lg bg-skeleton" />
          </div>
          <div class="h-6 w-2/5 rounded-md bg-skeleton" />
          <div class="h-3 w-3/4 rounded-full bg-skeleton" />
        </div>

        <div class="flex flex-wrap gap-2">
          <div class="h-7 w-24 rounded-full bg-skeleton" />
          <div class="h-7 w-28 rounded-full bg-skeleton" />
          <div class="h-7 w-20 rounded-full bg-skeleton" />
          <div class="h-7 w-24 rounded-full bg-skeleton" />
        </div>

        <div class="mt-auto flex justify-end gap-3">
          <div class="h-8 w-16 rounded-lg bg-skeleton" />
          <div class="h-8 w-28 rounded-lg bg-skeleton" />
        </div>
      </div>
    </Layer>
  );
}

/** Inline editor for a deferred CreateCalendarEvent tool call. */
function CalendarChatComposeContent(props: CalendarChatComposeProps) {
  const chat = useChatContext();
  const chatQuery = useChatQuery(() => props.chatId);
  const calendarsQuery = useVisibleCalendarsQuery();
  const contacts = useContacts();
  const [operation, setOperation] = createSignal<'create' | 'reject'>();

  const isOwner = () => chatQuery.data?.userAccessLevel === 'owner';
  const ownerGateDisabled = () => !chatQuery.isSuccess || !isOwner();
  const showOwnerDisabledMessage = () => chatQuery.isSuccess && !isOwner();
  const interactionLocked = () =>
    toolFinalized ||
    ownerGateDisabled() ||
    props.streamLocked === true ||
    operation() !== undefined;

  const guestOptions = createMemo(() =>
    contacts().map(recipientEntityMapper('user'))
  );
  const writableCalendars = createMemo(
    () => calendarsQuery.data?.filter((calendar) => calendar.isWritable) ?? []
  );
  const calendarsSpanInboxes = () => spansMultipleInboxes(writableCalendars());
  const calendarOptions = createMemo(() =>
    writableCalendars().map((calendar) => ({
      id: calendar.id,
      label: calendarDisplayLabel(calendar, calendarsSpanInboxes()),
      color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      defaultReminders: calendar.defaultReminders,
    }))
  );

  let toolFinalized = false;
  let lastPersistedSnapshot = JSON.stringify(props.initialData);
  let lastEnqueuedSnapshot = lastPersistedSnapshot;
  let persistenceQueue = Promise.resolve();

  const controller = createCalendarEventFormController({
    initialValue: createCalendarEventToEditorInitialValues(props.initialData),
    calendarOptions,
    guestOptions,
    recurrenceTimeZone:
      props.initialData.time.kind === 'timed'
        ? (props.initialData.time.timeZone ?? undefined)
        : undefined,
    onChange: scheduleUpdate,
  });

  function currentArgs(values = controller.submitValues()) {
    return values
      ? editorSubmitValuesToCreateCalendarEvent(values, props.initialData)
      : undefined;
  }

  const debouncedUpdate = debounce(() => void enqueueUpdate(), 150);

  function scheduleUpdate() {
    if (toolFinalized || interactionLocked()) return;
    debouncedUpdate();
  }

  function enqueueUpdate() {
    if (toolFinalized || operation() !== undefined) return persistenceQueue;
    const args = currentArgs();
    if (!args) return persistenceQueue;

    const snapshot = JSON.stringify(args);
    if (snapshot === lastEnqueuedSnapshot) return persistenceQueue;
    lastEnqueuedSnapshot = snapshot;

    persistenceQueue = persistenceQueue.then(async () => {
      if (toolFinalized) return;
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

  async function handleCreate(values: EventEditorSubmitValues) {
    if (interactionLocked()) return;
    setOperation('create');
    debouncedUpdate.clear();
    await persistenceQueue;

    const args = currentArgs(values);
    if (!args) {
      setOperation(undefined);
      return;
    }
    const result =
      await cognitionApiServiceClient.callTool<'CreateCalendarEvent'>({
        chat_id: props.chatId,
        messageId: props.messageId,
        toolCallId: props.toolCallId,
        args,
      });

    if (result.isErr()) {
      setOperation(undefined);
      toast.failure('Failed to create calendar event');
      return;
    }

    const event = createdEvent(result.value);
    if (!event) {
      setOperation(undefined);
      toast.failure('Failed to create calendar event', {
        subtext: toolError(result.value),
      });
      return;
    }

    toolFinalized = true;
    setOperation(undefined);
    updateLocalResponse(result.value as CreateCalendarEventResponse, args);
    void invalidateCalendarOccurrences();
    toast.success('Calendar event created', {
      actions: [{ label: 'Open', onClick: () => openToolCalendarEvent(event) }],
    });
  }

  async function handleCancel() {
    if (interactionLocked()) return;
    setOperation('reject');
    debouncedUpdate.clear();
    await persistenceQueue;

    const result = await cognitionApiServiceClient.rejectToolCall({
      chat_id: props.chatId,
      messageId: props.messageId,
      toolCallId: props.toolCallId,
    });
    if (result.isErr()) {
      setOperation(undefined);
      toast.failure('Failed to cancel calendar event');
      return;
    }

    toolFinalized = true;
    setOperation(undefined);
    updateLocalResponse('Rejected');
  }

  onCleanup(() => debouncedUpdate.clear());

  return (
    <Layer depth={2}>
      <div class="flex min-h-0 w-full flex-col gap-4">
        <div
          data-calendar-tool-composer
          class="flex min-h-80 max-h-128 min-w-0 flex-col gap-3 rounded-xl border border-edge-muted bg-surface p-4 text-ink shadow-sm"
        >
          <Show when={showOwnerDisabledMessage()}>
            <p class="text-xs text-ink-extra-muted/60">
              Only the chat owner can create or edit this calendar event.
            </p>
          </Show>
          <Show when={props.streamLocked && !showOwnerDisabledMessage()}>
            <p class="text-xs text-ink-extra-muted/60">
              Waiting for the response to finish before this event can be
              edited.
            </p>
          </Show>
          <Show when={outOfOfficeNotice(props.initialData)}>
            {(notice) => (
              <div
                role="note"
                aria-label="Out-of-office event"
                class="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-bg p-3 text-xs text-warning-ink"
              >
                <AirplaneTiltIcon class="mt-px size-4 shrink-0" />
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="font-medium">Out-of-office event</span>
                  <span>{notice().effect}</span>
                  <Show when={notice().declineMessage}>
                    {(message) => (
                      <span class="italic">
                        Auto-decline reply: “{message()}”
                      </span>
                    )}
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <EventForm
            controller={controller}
            class="min-w-0"
            disabled={
              toolFinalized ||
              ownerGateDisabled() ||
              props.streamLocked === true ||
              operation() === 'reject'
            }
            pending={operation() === 'create'}
            onCancel={() => void handleCancel()}
            onSubmit={(values) => void handleCreate(values)}
          />
        </div>
        <ErrorBoundary
          fallback={
            <div class="flex h-96 items-center justify-center rounded-xl border border-edge-muted bg-surface p-4 text-center text-xs text-ink-muted shadow-sm">
              Calendar preview unavailable.
            </div>
          }
        >
          <CalendarToolEventPreview
            controller={controller}
            eventId={`calendar-tool-preview:${props.toolCallId}`}
            showPeriodLabel
            showNavigationControls
            timeZone={
              props.initialData.time.kind === 'timed'
                ? (props.initialData.time.timeZone ?? undefined)
                : undefined
            }
            class="h-96 shrink-0"
          />
        </ErrorBoundary>
      </div>
    </Layer>
  );
}

/** Query-scoped boundary for the deferred calendar editor. */
export function CalendarChatCompose(props: CalendarChatComposeProps) {
  return (
    <Suspense fallback={<CalendarChatComposeFallback />}>
      <CalendarChatComposeContent {...props} />
    </Suspense>
  );
}
