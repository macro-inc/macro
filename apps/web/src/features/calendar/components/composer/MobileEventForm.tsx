import { DateTimeRange } from '@app/components/date-time-range/date-time-range-fields';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { cn, ToggleSwitch } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { EventFormParts } from './event-form-parts';
import { createEventForm, type EventFormProps } from './event-form-state';

/** A labelled row of a sheet section, its control on the right. */
function SheetRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-11 items-center justify-between gap-3 px-3">
      <span class="shrink-0 text-sm text-ink">{props.label}</span>
      <div class="flex min-w-0 flex-1 items-center justify-end gap-1">
        {props.children}
      </div>
    </div>
  );
}

/**
 * The create/edit event form in the touch bottom sheet: what and when first,
 * then the event's details, one per row.
 */
export function MobileEventForm(
  props: EventFormProps & {
    /** The sheet's pinned chrome, which keeps the save action in reach. */
    headerMount: HTMLElement;
  }
) {
  const form = createEventForm(props);

  return (
    // -mt-4 takes back the host's top padding: the sheet's pinned chrome
    // already separates the title from the handle.
    <EventFormParts.Root form={form} class={cn('-mt-4', props.class)}>
      <Portal mount={props.headerMount}>
        <div class="flex justify-end px-4 pb-1">
          <EventFormParts.Submit />
        </div>
        {/* Under the action that failed, so it shows however far the form
            is scrolled. */}
        <EventFormParts.SaveError class="px-4 pb-2" />
      </Portal>
      <div class="flex min-w-0 flex-col gap-6">
        <div class="flex min-w-0 flex-col gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <EventFormParts.Title />
            <EventFormParts.Description />
          </div>
          <EventFormParts.KindTabs />
        </div>

        <div class="flex min-w-0 flex-col gap-1">
          <MobileDrawer.Section class="mx-0">
            <ToggleSwitch
              class="min-h-11 w-full flex-row-reverse justify-between px-3"
              size="md"
              label="All-day"
              labelClass="text-sm text-ink"
              checked={form.state().allDay}
              disabled={form.fieldIsDisabled('allDay')}
              onChange={form.controller.setAllDay}
            />
            <EventFormParts.Range>
              <SheetRow label="Starts">
                <DateTimeRange.Start />
              </SheetRow>
              <SheetRow label="Ends">
                <DateTimeRange.End />
              </SheetRow>
            </EventFormParts.Range>
            <SheetRow label="Repeat">
              <EventFormParts.RecurrencePill />
            </SheetRow>
          </MobileDrawer.Section>
          <EventFormParts.RangeMessages />
          <EventFormParts.RecurrenceScopeReason />
        </div>
        <EventFormParts.CustomRecurrence />

        <MobileDrawer.Section class="mx-0">
          <SheetRow label="Calendar">
            <EventFormParts.CalendarPill />
          </SheetRow>
          <Show when={!form.isOutOfOffice()}>
            <SheetRow label="Guests">
              <EventFormParts.GuestsSheetPill />
            </SheetRow>
            <SheetRow label="Call">
              <EventFormParts.ConferencePill />
            </SheetRow>
            <SheetRow label="Location">
              <EventFormParts.LocationInput />
            </SheetRow>
          </Show>
          <Show when={form.isOutOfOffice()}>
            <SheetRow label="Declines">
              <EventFormParts.DeclinePill />
            </SheetRow>
            <Show when={form.showsDeclineMessage()}>
              <SheetRow label="Message">
                <EventFormParts.DeclineMessagePill />
              </SheetRow>
            </Show>
          </Show>
          <SheetRow label="Reminders">
            <EventFormParts.RemindersPill />
          </SheetRow>
        </MobileDrawer.Section>

        <EventFormParts.GuestPolicyRows />
        <EventFormParts.Notices />
      </div>
      <EventFormParts.EditScope />
    </EventFormParts.Root>
  );
}
