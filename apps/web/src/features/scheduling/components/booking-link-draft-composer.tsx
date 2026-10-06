import type { UserToolReviewSink } from '@core/component/AI/component/tool/user-tool-review';
import { createSignal, onCleanup, Show } from 'solid-js';
import {
  type BookingLinkArgs,
  editableBookingWeek,
} from '../core/booking-link';
import {
  type AvailabilitySchedule,
  type EventType,
  type SchedulingMember,
  validateSchedule,
} from '../core/types';
import { EventEditor } from './event-editor';
import { Field, TextInput } from './fields';
import { ScheduleFields } from './schedule-editor';

/** One review form shared by chat and agent elicitation, using the normal booking controls. */
export function BookingLinkDraftComposer(props: {
  initialData: BookingLinkArgs;
  sink: UserToolReviewSink<BookingLinkArgs>;
  members: SchedulingMember[];
  events?: EventType[];
}) {
  // These identities only connect the local controls. The domain assigns persisted IDs.
  const scheduleId = crypto.randomUUID();
  const eventId =
    'eventTypeId' in props.initialData
      ? props.initialData.eventTypeId
      : crypto.randomUUID();
  const [schedule, setSchedule] = createSignal<AvailabilitySchedule>({
    ...props.initialData.draft.schedule,
    weekly: editableBookingWeek(props.initialData.draft.schedule.weekly),
    id: scheduleId,
  });
  const [event, setEvent] = createSignal<EventType>({
    ...props.initialData.draft.event,
    dailyLimit: props.initialData.draft.event.dailyLimit ?? null,
    id: eventId,
    scheduleId,
  });
  const [pending, setPending] = createSignal(false);
  const [finished, setFinished] = createSignal(false);
  const [error, setError] = createSignal('');
  const locked = () => pending() || finished() || !props.sink.canAct();
  const args = (nextEvent = event()): BookingLinkArgs => {
    const { id: _eventId, scheduleId: _scheduleId, ...eventDraft } = nextEvent;
    const { id: _id, ...scheduleDraft } = schedule();
    return {
      ...props.initialData,
      draft: { event: eventDraft, schedule: scheduleDraft },
    };
  };
  const changeSchedule = (
    update: (current: AvailabilitySchedule) => AvailabilitySchedule
  ) => {
    if (locked()) return;
    setSchedule(update);
    props.sink.onEdit?.(args());
  };
  const decide = async (nextEvent?: EventType) => {
    if (locked()) return;
    setError('');
    if (nextEvent) {
      const message = validateSchedule(schedule());
      if (message) {
        setError(message);
        return;
      }
    }
    setPending(true);
    try {
      const done = nextEvent
        ? await props.sink.onExecute(args(nextEvent))
        : await props.sink.onReject();
      setFinished(done);
      if (!done)
        setError(
          'Could not finish this review. Your edits are preserved; try again.'
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the booking link. Try again.'
      );
    } finally {
      setPending(false);
    }
  };
  onCleanup(() => props.sink.onDispose?.());
  return (
    <div
      data-booking-link-composer
      class="max-h-[min(80dvh,52rem)] min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-edge-muted bg-panel p-3 text-ink sm:p-4"
    >
      <p class="mb-4 text-sm text-ink-muted">
        Review your booking link. Changes to availability apply only to this
        link. No invitations are sent until a guest books.
      </p>
      <Show when={props.sink.lockedNotice()}>
        {(notice) => <p class="mb-3 text-sm text-ink-muted">{notice()}</p>}
      </Show>
      <Show when={error()}>
        <p role="alert" class="mb-3 text-sm text-failure">
          {error()}
        </p>
      </Show>
      <fieldset
        disabled={locked()}
        inert={locked()}
        class="min-w-0 disabled:opacity-60"
      >
        <EventEditor
          event={event()}
          events={
            'eventTypeId' in props.initialData ? (props.events ?? []) : []
          }
          schedules={[schedule()]}
          members={props.members}
          team={!!props.initialData.teamId}
          saving={pending()}
          cancelEditingLabel="Cancel review"
          submitLabel={
            'eventTypeId' in props.initialData
              ? 'Save booking link'
              : 'Create booking link'
          }
          onChange={(value) => {
            if (locked()) return;
            setEvent(value);
            props.sink.onEdit?.(args(value));
          }}
          onSave={(value) => decide(value)}
          onCancel={() => void decide()}
          availability={
            <div class="flex min-w-0 flex-col gap-5">
              <Field label="Availability name">
                <TextInput
                  required
                  value={schedule().name}
                  onInput={(event) => {
                    const name = event.currentTarget.value;
                    changeSchedule((current) => ({ ...current, name }));
                  }}
                />
              </Field>
              <ScheduleFields schedule={schedule()} onChange={changeSchedule} />
            </div>
          }
        />
      </fieldset>
    </div>
  );
}
