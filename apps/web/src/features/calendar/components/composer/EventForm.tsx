import { EventFormParts } from './event-form-parts';
import { createEventForm, type EventFormProps } from './event-form-state';

/** Create/edit event form laid out like the standalone task composer. */
export function EventForm(props: EventFormProps) {
  const form = createEventForm(props);
  return (
    <EventFormParts.Root form={form} class={props.class}>
      <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto scrollbar-hidden">
        <div class="flex min-w-0 flex-col gap-6 text-sm text-ink-muted">
          <div class="flex min-w-0 flex-col gap-1">
            <EventFormParts.When />
            <EventFormParts.Title />
            <EventFormParts.Description />
          </div>
          <div class="flex min-w-0 flex-col gap-2">
            <EventFormParts.Properties />
            <EventFormParts.RecurrenceScopeReason />
          </div>
          <EventFormParts.GuestPolicy />
          <EventFormParts.Notices />
        </div>
        <EventFormParts.CustomRecurrence />
      </div>
      <EventFormParts.SaveError />
      <div class="flex shrink-0 items-center justify-end gap-3">
        <EventFormParts.EditScope class="mr-auto" />
        <EventFormParts.Cancel />
        <EventFormParts.Submit />
      </div>
    </EventFormParts.Root>
  );
}
