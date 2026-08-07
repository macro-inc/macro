import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { Popover } from '@kobalte/core/popover';
import PencilSimpleIcon from '@phosphor/pencil-simple.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TrashIcon from '@phosphor/trash.svg';
import CloseIcon from '@phosphor/x.svg';
import { useDeleteCalendarEventMutation } from '@queries/calendar/mutations';
import type { CalendarDeletionScope } from '@service-email/client';
import { Button, Dialog, Layer, Panel } from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import { EventAttendeesSection, EventDetails } from './EventDetails';
import { EventEditorDialog } from './EventEditorDialog';
import { EventRsvpSection } from './EventRsvpSection';
import type { CalendarEvent, CalendarTimeFormat } from './types';

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
  onOpenChange: (open: boolean) => void;
}

function EventDetailsDrawer(props: EventDetailsOverlayProps) {
  return (
    <MobileDrawer
      side="bottom"
      open
      onOpenChange={props.onOpenChange}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label={props.event.title}
          class="overflow-hidden"
        >
          <MobileDrawer.Handle />
          <div class="min-h-0 flex-1 overflow-y-auto">
            <div class="px-3 pb-3">
              <EventDetails event={props.event} timeFormat={props.timeFormat} />
            </div>
            <EventRsvpSection event={props.event} />
            <EventAttendeesSection attendees={props.event.attendees} />
          </div>
          <MobileDrawer.Close
            as={Button}
            aria-label="Close event details"
            variant="ghost"
            size="icon-sm"
            class="absolute right-2 top-2 rounded-full text-ink-muted"
          >
            <CloseIcon class="size-3" />
          </MobileDrawer.Close>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

interface EventDetailsPopoverProps extends EventDetailsOverlayProps {
  anchor: HTMLElement;
}

function DeleteEventDialog(props: {
  open: boolean;
  event: CalendarEvent;
  onClose: () => void;
  onDeleted: () => void;
}) {
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
    <Dialog
      open={props.open}
      onOpenChange={(open) =>
        !open && !deleteEvent.isPending && props.onClose()
      }
    >
      <Panel depth={2} class="max-w-[calc(100vw-2rem)] rounded-xl text-ink">
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={deleteEvent.isPending}
          >
            <CloseIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            Delete event
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-3 p-3">
          <Show
            when={isRecurring()}
            fallback={
              <p class="max-w-80 text-sm text-ink-muted">
                Delete “{props.event.title || 'Untitled event'}”? Guests will be
                notified.
              </p>
            }
          >
            <div class="flex max-w-80 flex-col gap-2 text-sm text-ink-muted">
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
          <div class="flex justify-end gap-1 pt-2">
            <Button
              variant="ghost"
              class="rounded-lg"
              disabled={deleteEvent.isPending}
              label="Cancel"
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="active"
              class="rounded-lg"
              disabled={deleteEvent.isPending}
              label="Delete"
              onClick={confirm}
            >
              <Show when={deleteEvent.isPending} fallback="Delete">
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

/** Anchors event details and actions to a rendered calendar event. */
function EventDetailsPopover(props: EventDetailsPopoverProps) {
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const canModify = () => !props.event.isReadOnly && !props.event.isCancelled;

  return (
    <>
      <Popover
        anchorRef={() => props.anchor}
        open
        onOpenChange={(open) => {
          // Keep the popover mounted while one of its dialogs is up; the
          // dialog's own close path decides what happens next.
          if (!open && (deleteOpen() || editorOpen())) return;
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
              class="z-modal max-w-[calc(100vw-2rem)] outline-none"
              onInteractOutside={(event) => {
                // FullCalendar selects on click (pointer release), so dismissing on
                // pointer down would briefly close the popover before reopening it.
                const target = event.detail.originalEvent.target;
                if (
                  target instanceof Element &&
                  target.closest('.fc-event') !== null
                ) {
                  event.preventDefault();
                }
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
              <div class="relative w-fit min-w-[min(20rem,calc(100vw-2rem))] max-w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-surface text-ink shadow-menu ring ring-edge-muted">
                <Popover.Title class="sr-only">
                  {props.event.title}
                </Popover.Title>
                <div class="p-3">
                  <EventDetails
                    event={props.event}
                    timeFormat={props.timeFormat}
                  />
                </div>
                <EventRsvpSection event={props.event} />
                <EventAttendeesSection attendees={props.event.attendees} />
                <div class="absolute right-2 top-2 flex items-center gap-0.5">
                  <Show when={canModify()}>
                    <Button
                      aria-label="Edit event"
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-md text-ink-muted"
                      onClick={() => setEditorOpen(true)}
                    >
                      <PencilSimpleIcon class="size-3" />
                    </Button>
                    <Button
                      aria-label="Delete event"
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-md text-ink-muted"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <TrashIcon class="size-3" />
                    </Button>
                  </Show>
                  <Popover.CloseButton
                    as={Button}
                    aria-label="Close event details"
                    variant="ghost"
                    size="icon-sm"
                    class="rounded-md text-ink-muted"
                  >
                    <CloseIcon class="size-3" />
                  </Popover.CloseButton>
                </div>
              </div>
            </Popover.Content>
          </Layer>
        </Popover.Portal>
      </Popover>
      <Show when={deleteOpen()}>
        <DeleteEventDialog
          open
          event={props.event}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            props.onOpenChange(false);
          }}
        />
      </Show>
      <Show when={editorOpen()}>
        <EventEditorDialog
          open
          event={props.event}
          onClose={() => setEditorOpen(false)}
        />
      </Show>
    </>
  );
}
