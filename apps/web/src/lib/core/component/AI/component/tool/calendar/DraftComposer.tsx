/**
 * The calendar event composer for a drafted `CreateCalendarEvent` call, with
 * no opinion about where the draft came from or where the decision goes.
 *
 * Chat mounts it over a pending user tool and finishes the call through the
 * cognition endpoints; an agent session mounts it over a review elicitation
 * and answers the agent. Both hand in a {@link UserToolReviewSink}; the
 * composer only knows how to edit the draft and what the two buttons mean.
 */

import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import type { EventEditorSubmitValues } from '@app/features/calendar/components/composer/event-form-model';
import { DEFAULT_CALENDAR_SOURCE } from '@app/features/calendar/types';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '@app/features/calendar/utils/calendar-label';
import { recipientEntityMapper, useContacts } from '@core/user';
import AirplaneTiltIcon from '@phosphor/airplane-tilt.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { Layer } from '@ui';
import {
  createMemo,
  createSignal,
  ErrorBoundary,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import { CalendarToolEventPreview } from './EventPreview';
import {
  createCalendarEventToEditorInitialValues,
  editorSubmitValuesToCreateCalendarEvent,
  outOfOfficeNotice,
} from './event-form-adapter';

export type CalendarDraftComposerProps = {
  /** The draft as the agent wrote it. */
  initialData: CreateCalendarEvent;
  /** Where edits, the confirmation and the rejection go. */
  sink: UserToolReviewSink<CreateCalendarEvent>;
  /** A key for the preview's synthetic event; the call's id in practice. */
  previewKey: string;
  /** Show the calendar preview under the form. On by default. */
  showPreview?: boolean;
};

function CalendarDraftComposerFallback() {
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

function CalendarDraftComposerContent(props: CalendarDraftComposerProps) {
  const calendarsQuery = useVisibleCalendarsQuery();
  const contacts = useContacts();
  const [operation, setOperation] = createSignal<'create' | 'reject'>();
  let finalized = false;

  const interactionLocked = () =>
    finalized || !props.sink.canAct() || operation() !== undefined;

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

  const controller = createCalendarEventFormController({
    initialValue: createCalendarEventToEditorInitialValues(props.initialData),
    calendarOptions,
    guestOptions,
    recurrenceTimeZone:
      props.initialData.time.kind === 'timed'
        ? (props.initialData.time.timeZone ?? undefined)
        : undefined,
    onChange: () => {
      if (interactionLocked()) return;
      const args = currentArgs();
      if (args) props.sink.onEdit?.(args);
    },
  });

  function currentArgs(values = controller.submitValues()) {
    return values
      ? editorSubmitValuesToCreateCalendarEvent(values, props.initialData)
      : undefined;
  }

  async function handleCreate(values: EventEditorSubmitValues) {
    if (interactionLocked()) return;
    const args = currentArgs(values);
    if (!args) return;
    setOperation('create');
    const done = await props.sink.onExecute(args);
    setOperation(undefined);
    if (done) finalized = true;
  }

  async function handleCancel() {
    if (interactionLocked()) return;
    setOperation('reject');
    const done = await props.sink.onReject();
    setOperation(undefined);
    if (done) finalized = true;
  }

  onCleanup(() => props.sink.onDispose?.());

  return (
    <Layer depth={2}>
      <div class="flex min-h-0 w-full flex-col gap-4">
        <div
          data-calendar-tool-composer
          class="flex min-h-80 max-h-128 min-w-0 flex-col gap-3 rounded-xl border border-edge-muted bg-surface p-4 text-ink shadow-sm"
        >
          <Show when={props.sink.lockedNotice()}>
            {(notice) => (
              <p class="text-xs text-ink-extra-muted/60">{notice()}</p>
            )}
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
              finalized || !props.sink.canAct() || operation() === 'reject'
            }
            pending={operation() === 'create'}
            onCancel={() => void handleCancel()}
            onSubmit={(values) => void handleCreate(values)}
          />
        </div>
        <Show when={props.showPreview !== false}>
          <ErrorBoundary
            fallback={
              <div class="flex h-96 items-center justify-center rounded-xl border border-edge-muted bg-surface p-4 text-center text-xs text-ink-muted shadow-sm">
                Calendar preview unavailable.
              </div>
            }
          >
            <CalendarToolEventPreview
              controller={controller}
              eventId={`calendar-tool-preview:${props.previewKey}`}
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
        </Show>
      </div>
    </Layer>
  );
}

/** Query-scoped boundary for the calendar draft composer. */
export function CalendarDraftComposer(props: CalendarDraftComposerProps) {
  return (
    <Suspense fallback={<CalendarDraftComposerFallback />}>
      <CalendarDraftComposerContent {...props} />
    </Suspense>
  );
}
