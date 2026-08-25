import { hasEveryoneElseDeclined } from '@app/features/calendar/components/EventContent';
import {
  EventAttendeesSection,
  EventDetails,
} from '@app/features/calendar/components/EventDetails';
import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { Popover } from '@kobalte/core/popover';
import ExclamationIcon from '@phosphor/exclamation-mark.svg';
import LinkIcon from '@phosphor/link.svg';
import PencilSimpleIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import CloseIcon from '@phosphor/x.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useDeleteCalendarEventMutation } from '@queries/calendar/mutations';
import type { CalendarDeletionScope } from '@service-email/client';
import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import {
  Button,
  DeleteDialog,
  Layer,
  type ManagedDialogProps,
  useImperativeDialog,
} from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import { copyCalendarEventMention } from '../copy-event-mention';
import { EventRsvpSection } from './EventRsvpSection';
import { useOpenEventComposer } from './use-open-event-composer';

interface SelectedEventDetailsProps {
  anchor: Accessor<HTMLElement | undefined>;
  event: Accessor<CalendarEvent | undefined>;
  timeFormat: Accessor<CalendarTimeFormat>;
  onClose: () => void;
}

/**
 * Renders selected event details in a mobile drawer or anchored popover.
 *
 * Both are keyed on the stable event id — not the view model's object
 * identity — so optimistic cache writes and refetches update them in place
 * instead of remounting them (which would close their dialogs). When the
 * event leaves the cache entirely (e.g. deleted from another tab) the
 * overlay closes rather than lingering on stale data.
 */
export function SelectedEventDetails(props: SelectedEventDetailsProps) {
  const calendarsQuery = useVisibleCalendarsQuery();
  const defaultReminders = (event: CalendarEvent) =>
    calendarsQuery.data?.find((calendar) => calendar.id === event.calendarId)
      ?.defaultReminders;
  const popoverSelection = createMemo(
    () => {
      const event = props.event();
      const anchor = props.anchor();

      return event && anchor ? { anchor, eventId: event.id } : undefined;
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.anchor === next?.anchor &&
        previous?.eventId === next?.eventId,
    }
  );
  const drawerSelection = createMemo(() => props.event()?.id, undefined, {
    equals: (previous, next) => previous === next,
  });

  return (
    <Show
      when={isMobile()}
      fallback={
        <Show keyed when={popoverSelection()}>
          {(selected) => (
            <Show when={props.event()}>
              {(currentEvent) => (
                <EventDetailsPopover
                  anchor={selected.anchor}
                  event={currentEvent()}
                  timeFormat={props.timeFormat()}
                  defaultReminders={defaultReminders(currentEvent())}
                  onOpenChange={(open) => {
                    if (!open) props.onClose();
                  }}
                />
              )}
            </Show>
          )}
        </Show>
      }
    >
      <Show keyed when={drawerSelection()}>
        <Show when={props.event()}>
          {(currentEvent) => (
            <EventDetailsDrawer
              event={currentEvent()}
              timeFormat={props.timeFormat()}
              defaultReminders={defaultReminders(currentEvent())}
              onOpenChange={(open) => {
                if (!open) props.onClose();
              }}
            />
          )}
        </Show>
      </Show>
    </Show>
  );
}

interface EventDetailsOverlayProps {
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
  defaultReminders?: EventReminderOverride[];
  onOpenChange: (open: boolean) => void;
}

function EveryoneElseDeclinedNotice(props: {
  event: CalendarEvent;
  canModify: boolean;
  onDelete: () => void;
  onReschedule: () => void;
}) {
  return (
    <Show when={hasEveryoneElseDeclined(props.event)}>
      <div class="border-edge-muted mx-3 mb-3 grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 rounded-lg border bg-active p-3 text-sm text-ink-muted sm:mt-2 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-3 sm:text-xs">
        <span
          aria-hidden="true"
          class="flex size-5 shrink-0 items-center justify-center rounded bg-ink/10 text-ink-muted sm:size-4"
        >
          <ExclamationIcon class="size-3" />
        </span>
        <div class="flex min-w-0 flex-col gap-4">
          <div role="status" class="font-medium text-ink">
            Everyone else declined this event
          </div>
          <Show when={props.canModify}>
            <div class="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="rounded-lg"
                onClick={props.onDelete}
              >
                Delete
              </Button>
              <Button
                variant="cta"
                size="sm"
                class="rounded-lg"
                onClick={props.onReschedule}
              >
                Reschedule
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

function EventDetailsDrawer(props: EventDetailsOverlayProps) {
  const openEventComposer = useOpenEventComposer();
  const deleteDialog = useDeleteEventDialog({
    event: () => props.event,
    onDeleted: () => props.onOpenChange(false),
  });
  const canModify = () => !props.event.isReadOnly && !props.event.isCancelled;
  const openEditor = () => {
    openEventComposer({ event: props.event });
    props.onOpenChange(false);
  };

  return (
    <MobileDrawer
      side="bottom"
      open
      onOpenChange={(open) => {
        if (!open && deleteDialog.isOpen()) return;
        props.onOpenChange(open);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label={props.event.title}
          class="overflow-hidden"
        >
          <MobileDrawer.Handle class="pointer-events-none absolute inset-x-0 top-0 z-1" />
          <div class="flex shrink-0 items-center justify-between px-2 pb-3 pt-2">
            <MobileDrawer.Close
              as={Button}
              aria-label="Close event details"
              variant="ghost"
              size="icon-md"
              depth={3}
              class="rounded-md text-ink-extra-muted [&_svg]:size-4"
            >
              <CloseIcon />
            </MobileDrawer.Close>
            <div class="flex items-center gap-1">
              <Button
                aria-label="Copy event"
                variant="ghost"
                size="icon-md"
                depth={3}
                class="rounded-md text-ink-extra-muted [&_svg]:size-4"
                onClick={() => copyCalendarEventMention(props.event)}
              >
                <LinkIcon />
              </Button>
              <Show when={canModify()}>
                <Button
                  aria-label="Edit event"
                  variant="ghost"
                  size="icon-md"
                  depth={3}
                  class="rounded-md text-ink-extra-muted [&_svg]:size-4"
                  onClick={openEditor}
                >
                  <PencilSimpleIcon />
                </Button>
                <Button
                  aria-label="Delete event"
                  variant="ghost"
                  size="icon-md"
                  depth={3}
                  class="rounded-md text-ink-extra-muted [&_svg]:size-4"
                  onClick={deleteDialog.open}
                >
                  <TrashIcon />
                </Button>
              </Show>
            </div>
          </div>
          <MobileDrawer.ScrollBody>
            <EveryoneElseDeclinedNotice
              event={props.event}
              canModify={canModify()}
              onDelete={deleteDialog.open}
              onReschedule={openEditor}
            />
            <div class="px-3">
              <EventDetails
                event={props.event}
                timeFormat={props.timeFormat}
                defaultReminders={props.defaultReminders}
              />
            </div>
            <EventAttendeesSection attendees={props.event.attendees} />
            <EventRsvpSection event={props.event} buttonSize="md" />
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

interface EventDetailsPopoverProps extends EventDetailsOverlayProps {
  anchor: HTMLElement;
}

function useDeleteEventDialog(props: {
  event: Accessor<CalendarEvent>;
  onDeleted: () => void;
}) {
  const dialog = useImperativeDialog(DeleteEventDialog);

  const open = () =>
    dialog.open({
      event: props.event(),
      onDeleted: () => {
        dialog.close();
        props.onDeleted();
      },
    });

  return { open, isOpen: dialog.isOpen };
}

function DeleteEventDialog(
  props: ManagedDialogProps & {
    event: CalendarEvent;
    onDeleted: () => void;
  }
) {
  const isRecurring = () =>
    props.event.recurrenceLines.length > 0 ||
    props.event.recurrenceId !== undefined;
  const [scope, setScope] = createSignal<CalendarDeletionScope>('this_event');
  const deleteEvent = useDeleteCalendarEventMutation({
    onSuccess: () => props.onDeleted(),
    onError: (error) => {
      toast.failure('Failed to delete event', { subtext: error.message });
    },
  });
  const confirm = () => {
    const effectiveScope = isRecurring() ? scope() : 'all';
    deleteEvent.mutate({
      eventId: props.event.eventId,
      scope: effectiveScope,
      recurrenceId:
        effectiveScope === 'all'
          ? undefined
          : (props.event.recurrenceId ?? props.event.occurrenceKey),
      occurrenceKey:
        effectiveScope === 'all' ? undefined : props.event.occurrenceKey,
    });
  };

  return (
    <DeleteDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Delete event"
      pending={deleteEvent.isPending}
      onDelete={confirm}
    >
      <Show
        when={isRecurring()}
        fallback={
          <p>
            Delete “{props.event.title || 'Untitled event'}”? Guests will be
            notified.
          </p>
        }
      >
        <div class="flex flex-col gap-2">
          <p>
            Remove “{props.event.title || 'Untitled event'}”? Guests will be
            notified.
          </p>
          <label class="flex items-center gap-2">
            <input
              type="radio"
              name="delete-scope"
              checked={scope() === 'this_event'}
              onChange={() => setScope('this_event')}
            />
            This event
          </label>
          <label class="flex items-center gap-2">
            <input
              type="radio"
              name="delete-scope"
              checked={scope() === 'this_and_following'}
              onChange={() => setScope('this_and_following')}
            />
            This and following events
          </label>
          <label class="flex items-center gap-2">
            <input
              type="radio"
              name="delete-scope"
              checked={scope() === 'all'}
              onChange={() => setScope('all')}
            />
            All events
          </label>
        </div>
      </Show>
    </DeleteDialog>
  );
}

/** Anchors event details and actions to a rendered calendar event. */
function EventDetailsPopover(props: EventDetailsPopoverProps) {
  const openEventComposer = useOpenEventComposer();
  const deleteDialog = useDeleteEventDialog({
    event: () => props.event,
    onDeleted: () => props.onOpenChange(false),
  });
  const canModify = () => !props.event.isReadOnly && !props.event.isCancelled;
  const openEditor = () => {
    openEventComposer({ event: props.event });
    props.onOpenChange(false);
  };

  return (
    <Popover
      anchorRef={() => props.anchor}
      open
      onOpenChange={(open) => {
        // Keep the popover mounted while its delete dialog is open.
        if (!open && deleteDialog.isOpen()) return;
        props.onOpenChange(open);
      }}
      placement="right-start"
      gutter={8}
      flip
      slide
    >
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-modal max-w-[calc(100vw-2rem)] outline-none"
            onInteractOutside={(event) => {
              // FullCalendar and external calendar target controls select on
              // click (pointer release), so dismissing on pointer down would
              // briefly close the popover before navigation finishes.
              const target = event.detail.originalEvent.target;
              if (
                target instanceof Element &&
                (target.closest('.fc-event') !== null ||
                  target.closest('[data-calendar-event-target-navigation]') !==
                    null)
              ) {
                event.preventDefault();
              }
            }}
            onFocusOutside={(event) => {
              // Deep links open this popover while their freshly-opened
              // split is still claiming focus; that focus movement lands
              // outside the popover and would dismiss it on arrival. Focus
              // alone never closes the details — pointer interaction
              // outside or Escape still does.
              event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              const shouldRestoreFocus = !event.defaultPrevented;
              event.preventDefault();
              if (shouldRestoreFocus && props.anchor.isConnected) {
                props.anchor.focus();
              }
            }}
          >
            <Popover.Arrow class="fill-surface" />
            <div class="w-fit min-w-[min(20rem,calc(100vw-2rem))] max-w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-surface text-ink shadow-menu ring ring-edge-muted">
              <Popover.Title class="sr-only">{props.event.title}</Popover.Title>
              <div class="flex items-center justify-end gap-1 px-2 pt-2">
                <Button
                  aria-label="Copy event"
                  variant="ghost"
                  size="icon-sm"
                  depth={3}
                  class="rounded-md text-ink-muted [&_svg]:size-4"
                  onClick={() => copyCalendarEventMention(props.event)}
                >
                  <LinkIcon />
                </Button>
                <Show when={canModify()}>
                  <Button
                    aria-label="Edit event"
                    variant="ghost"
                    size="icon-sm"
                    depth={3}
                    class="rounded-md text-ink-muted [&_svg]:size-4"
                    onClick={openEditor}
                  >
                    <PencilSimpleIcon />
                  </Button>
                  <Button
                    aria-label="Delete event"
                    variant="ghost"
                    size="icon-sm"
                    depth={3}
                    class="rounded-md text-ink-muted [&_svg]:size-4"
                    onClick={deleteDialog.open}
                  >
                    <TrashIcon />
                  </Button>
                </Show>
                <Popover.CloseButton
                  as={Button}
                  aria-label="Close event details"
                  variant="ghost"
                  size="icon-sm"
                  depth={3}
                  class="rounded-md text-ink-muted [&_svg]:size-4"
                >
                  <CloseIcon />
                </Popover.CloseButton>
              </div>
              <EveryoneElseDeclinedNotice
                event={props.event}
                canModify={canModify()}
                onDelete={deleteDialog.open}
                onReschedule={openEditor}
              />
              <div>
                <div class="px-3 pb-3">
                  <EventDetails
                    event={props.event}
                    timeFormat={props.timeFormat}
                    defaultReminders={props.defaultReminders}
                  />
                </div>
                <EventAttendeesSection attendees={props.event.attendees} />
                <EventRsvpSection event={props.event} />
              </div>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
