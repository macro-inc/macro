import { toast } from '@core/component/Toast/Toast';
import CalendarPlusIcon from '@icon/system/regular/calendar-plus.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  isAlreadyOnCalendar,
  isCopyRefused,
  isJoinRequestOpen,
} from '@queries/calendar/copy';
import { queryReadyGate } from '@queries/gate';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';

/** Tell the viewer why a snapshot did not reach their calendar. */
export function toastAddToCalendarFailure(error: unknown) {
  if (isAlreadyOnCalendar(error)) {
    toast.failure('This event is already on your calendar');
  } else if (isJoinRequestOpen(error)) {
    toast.failure("You've asked to join this event", {
      subtext: "It reaches your calendar once you're added as a guest.",
    });
  } else if (isCopyRefused(error)) {
    toast.failure("Google Calendar won't add this event to that calendar", {
      subtext: 'Download the .ics file to add it another way.',
    });
  } else {
    toast.failure('Failed to add the event to your calendar');
  }
}

/**
 * Add a snapshot of an event the viewer does not hold to one of their Google
 * calendars: one button, or a menu of calendars when they have several.
 */
export function AddToCalendarButton(props: {
  size: 'xs' | 'md';
  pending: boolean;
  onAdd: (calendarId: string | undefined) => void;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const calendars = useVisibleCalendarsQuery();
  // Only Google imports a copy under the meeting's own UID, which is what
  // lets the event resolve to it. Reading `data` while the list is pending
  // would suspend the host; until it arrives there is nothing to pick.
  const targetCalendars = () =>
    (queryReadyGate(calendars) ? calendars.data : []).filter(
      (calendar) =>
        calendar.isWritable &&
        calendar.provider === 'google' &&
        !calendar.isSubscription
    );

  return (
    <Show
      when={targetCalendars().length > 1}
      fallback={
        <Button
          variant="secondary"
          size={props.size}
          disabled={props.pending || targetCalendars().length === 0}
          onClick={() => props.onAdd(targetCalendars()[0]?.id)}
        >
          <CalendarPlusIcon
            class={
              props.size === 'xs'
                ? 'size-3 shrink-0 touch:size-6'
                : 'size-4 shrink-0 touch:size-6'
            }
          />
          Add to calendar
        </Button>
      }
    >
      <Dropdown onOpenChange={(open) => props.onMenuOpenChange?.(open)}>
        <Dropdown.Trigger
          variant="secondary"
          size={props.size}
          disabled={props.pending}
        >
          <CalendarPlusIcon
            class={
              props.size === 'xs'
                ? 'size-3 shrink-0 touch:size-6'
                : 'size-4 shrink-0 touch:size-6'
            }
          />
          Add to calendar
          <CaretDownIcon
            class={
              props.size === 'xs'
                ? 'size-3 shrink-0 touch:size-6'
                : 'size-4 shrink-0 touch:size-6'
            }
          />
        </Dropdown.Trigger>
        <Dropdown.Content blockingBackdrop class="z-nested-action-menu">
          <Dropdown.Group>
            <For each={targetCalendars()}>
              {(calendar) => (
                <Dropdown.Item onSelect={() => props.onAdd(calendar.id)}>
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate">{calendar.name}</span>
                    <Show when={calendar.name !== calendar.emailAddress}>
                      <span class="truncate text-xs text-ink-muted">
                        {calendar.emailAddress}
                      </span>
                    </Show>
                  </span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
