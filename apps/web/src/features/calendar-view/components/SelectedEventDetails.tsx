import { ComposerDropTarget } from '@app/features/calendar/components/composer/parts/ComposerDropTarget';
import { hasEveryoneElseDeclined } from '@app/features/calendar/components/EventContent';
import { EventDetails } from '@app/features/calendar/components/EventDetails';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { createGuestInviteController } from '@app/features/calendar/hooks/create-guest-invite-controller';
import {
  useCalendarGuestInvitesFlag,
  useCalendarInvitationForwardFlag,
} from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { createCalendarPanelPlacement } from '@app/features/calendar/primitives/create-calendar-panel-placement';
import {
  type CalendarEvent,
  type CalendarTimeFormat,
  reminderCalendarIdOf,
} from '@app/features/calendar/types';
import {
  canDeleteCalendarEvent,
  canEditCalendarEvent,
} from '@app/features/calendar/utils/event-interaction';
import { eventEmailRecipients } from '@app/features/calendar/utils/guest-emails';
import { handleOpenEventOutsidePress } from '@app/features/calendar/utils/open-event-outside-press';
import { TeamEventDetails } from '@app/features/calendar-team/components/team-event-details';
import { EventGuests } from '@app/features/calendar-view/components/EventGuests';
import { EventJoinRequests } from '@app/features/calendar-view/components/EventJoinRequests';
import { EventRsvpSection } from '@app/features/calendar-view/components/EventRsvpSection';
import { useForwardEventEmail } from '@app/features/calendar-view/components/use-forward-event-email';
import { useOpenEventComposer } from '@app/features/calendar-view/components/use-open-event-composer';
import { copyCalendarEventMention } from '@app/features/calendar-view/copy-event-mention';
import { downloadCalendarEventIcs } from '@app/features/calendar-view/download-event-ics';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { openExternalUrl } from '@core/util/url';
import ArrowBendUpRightIcon from '@icon/system/regular/arrow-bend-up-right.svg';
import DownloadSimpleIcon from '@icon/system/regular/download-simple.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilSimpleIcon from '@icon/system/regular/pencil-simple.svg';
import SidePanelIcon from '@icon/system/regular/sidebar-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useDeleteCalendarEventMutation } from '@queries/calendar/mutations';
import type { CalendarDeletionScope } from '@service-email/client';
import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import {
  Button,
  DeleteDialog,
  Layer,
  type ManagedDialogProps,
  RadioGroup,
  useImperativeDialog,
} from '@ui';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';

interface SelectedEventDetailsProps {
  boundary: HTMLElement;
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
    calendarsQuery.isSuccess
      ? calendarsQuery.data?.find(
          (calendar) => calendar.id === reminderCalendarIdOf(event)
        )?.defaultReminders
      : undefined;
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
                  boundary={props.boundary}
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
  canEdit: boolean;
  onDelete: () => void;
  onReschedule: () => void;
}) {
  return (
    <Show
      when={!props.event.teamProjection && hasEveryoneElseDeclined(props.event)}
    >
      <div class="border-edge-muted mx-3 mb-3 grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 rounded-lg border bg-active p-3 text-sm text-ink-muted sm:mt-2 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-3 sm:text-xs">
        <span
          aria-hidden="true"
          class="flex size-5 shrink-0 items-center justify-center rounded bg-control text-ink-muted sm:size-4"
        >
          <ExclamationIcon class="size-3" />
        </span>
        <div class="flex min-w-0 flex-col gap-4">
          <div role="status" class="font-medium text-ink">
            Everyone else declined this event
          </div>
          <Show when={props.canEdit}>
            <div class="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={props.onDelete}>
                Delete
              </Button>
              <Button variant="primary" size="sm" onClick={props.onReschedule}>
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
  const invites = createGuestInviteController(
    () => props.event,
    useCalendarGuestInvitesFlag(),
    useCalendarInvitationForwardFlag()
  );
  const canEdit = () => canEditCalendarEvent(props.event);
  const canDelete = () => canDeleteCalendarEvent(props.event);
  const openEditor = () => {
    openEventComposer({ event: props.event });
    props.onOpenChange(false);
  };
  const forwardEventEmail = useForwardEventEmail();
  const forwardByEmail = () =>
    forwardEventEmail(props.event, {
      timeFormat: props.timeFormat,
      closeDetails: () => props.onOpenChange(false),
    });

  return (
    <MobileDrawer
      side="bottom"
      open
      onOpenChange={(open) => {
        if (
          !open &&
          (deleteDialog.isOpen() ||
            invites.editorOpen() ||
            invites.forwardEditorOpen())
        )
          return;
        props.onOpenChange(open);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={props.event.title}
          class="overflow-hidden"
        >
          <MobileDrawer.Handle class="pb-1" />
          <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-4">
            <MobileDrawer.Close
              as={Button}
              aria-label="Close event details"
              variant="ghost"
              size="icon-md"
              class="size-11 rounded-full bg-control text-ink-muted"
            >
              <CloseIcon class="size-5 shrink-0" />
            </MobileDrawer.Close>
            <div class="flex items-center gap-1">
              <Show when={!props.event.teamProjection}>
                <Button
                  aria-label="Copy event"
                  tooltip="Copy event"
                  variant="ghost"
                  size="icon-md"
                  class="size-11 bg-control text-ink-muted"
                  onClick={() => copyCalendarEventMention(props.event)}
                >
                  <LinkIcon class="size-5 shrink-0" />
                </Button>
                <Button
                  aria-label="Download .ics"
                  tooltip="Download .ics"
                  variant="ghost"
                  size="icon-md"
                  class="size-11 bg-control text-ink-muted"
                  onClick={() => downloadCalendarEventIcs(props.event)}
                >
                  <DownloadSimpleIcon class="size-5 shrink-0" />
                </Button>
                <Button
                  aria-label="Forward by email"
                  tooltip="Forward by email"
                  variant="ghost"
                  size="icon-md"
                  class="size-11 bg-control text-ink-muted"
                  onClick={forwardByEmail}
                >
                  <ArrowBendUpRightIcon class="size-5 shrink-0" />
                </Button>
              </Show>
              <Show when={canEdit()}>
                <Button
                  aria-label="Edit event"
                  tooltip="Edit event"
                  variant="ghost"
                  size="icon-md"
                  class="size-11 bg-control text-ink-muted"
                  onClick={openEditor}
                >
                  <PencilSimpleIcon class="size-5 shrink-0" />
                </Button>
              </Show>
              <Show when={canDelete()}>
                <Button
                  aria-label={deleteEventLabel(props.event)}
                  tooltip={deleteEventLabel(props.event)}
                  variant="ghost"
                  size="icon-md"
                  class="size-11 bg-control text-ink-muted"
                  onClick={deleteDialog.open}
                >
                  <TrashIcon class="size-5 shrink-0" />
                </Button>
              </Show>
            </div>
          </div>
          <MobileDrawer.ScrollBody>
            <EveryoneElseDeclinedNotice
              event={props.event}
              canEdit={canEdit()}
              onDelete={deleteDialog.open}
              onReschedule={openEditor}
            />
            <EventJoinRequests
              eventId={props.event.eventId}
              canModify={canEdit()}
            />
            <div class="px-3">
              <Show
                when={props.event.teamProjection}
                fallback={
                  <EventDetails
                    event={props.event}
                    timeFormat={props.timeFormat}
                    defaultReminders={props.defaultReminders}
                  />
                }
              >
                <TeamEventDetails
                  event={props.event}
                  timeFormat={props.timeFormat}
                  onOpenLink={openExternalUrl}
                />
              </Show>
            </div>
            <Show when={!props.event.teamProjection}>
              <EventGuests
                event={props.event}
                invites={invites}
                closeDetails={() => props.onOpenChange(false)}
              />
            </Show>
            <Show when={!props.event.teamProjection}>
              <EventRsvpSection event={props.event} buttonSize="md" />
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

interface EventDetailsPopoverProps extends EventDetailsOverlayProps {
  anchor: HTMLElement;
  boundary: HTMLElement;
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

/** A snapshot is the viewer's own copy; deleting it leaves the meeting alone. */
function deleteEventLabel(event: CalendarEvent) {
  return event.isSnapshot ? 'Delete your copy' : 'Delete event';
}

const DELETE_SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'this_and_following', label: 'This and following events' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarDeletionScope;
  label: string;
}[];

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
      calendarId: props.event.calendarId,
      scope: effectiveScope,
      recurrenceId:
        effectiveScope === 'all'
          ? undefined
          : (props.event.recurrenceId ?? props.event.occurrenceKey),
      occurrenceKey:
        effectiveScope === 'all' ? undefined : props.event.occurrenceKey,
    });
  };

  const title = () => props.event.title || 'Untitled event';
  const prompt = () => {
    if (props.event.isSnapshot) {
      return `Delete your copy of “${title()}”? The shared event stays as it is.`;
    }
    const question = `${isRecurring() ? 'Remove' : 'Delete'} “${title()}”?`;
    return eventEmailRecipients(props.event).length > 0
      ? `${question} Guests will be notified.`
      : question;
  };

  return (
    <DeleteDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={deleteEventLabel(props.event)}
      pending={deleteEvent.isPending}
      onDelete={confirm}
    >
      <Show when={isRecurring()} fallback={<p>{prompt()}</p>}>
        <div class="flex flex-col gap-3">
          <p>{prompt()}</p>
          <RadioGroup
            value={scope()}
            onChange={(value) => setScope(value as CalendarDeletionScope)}
            aria-label="Delete recurring event"
          >
            <For each={DELETE_SCOPE_OPTIONS}>
              {(option) => (
                <RadioGroup.Item value={option.scope}>
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
        </div>
      </Show>
    </DeleteDialog>
  );
}

/**
 * Anchors event details and actions to a rendered calendar event.
 * The calendar viewport contains both the portal and its collision boundary.
 * Wide events can overlap the card so it stays inside that viewport. Details
 * scroll within 32rem or the available height; the RSVP row stays pinned.
 */
function EventDetailsPopover(props: EventDetailsPopoverProps) {
  const openEventComposer = useOpenEventComposer();
  const host = useCalendarComposerHost();
  let content: HTMLDivElement | undefined;
  const pinned = () => host?.cardPinned() ?? false;
  const { drag, docked, dockRect, anchorRect, maxHeight } =
    createCalendarPanelPlacement({
      kind: 'event-card',
      boundary: () => host?.boundary() ?? props.boundary,
      dock: () => host?.dock(),
      surface: () => content,
      anchor: () =>
        props.anchor.isConnected
          ? props.anchor.getBoundingClientRect()
          : undefined,
      pinned,
      disabled: () => !host || host.sessions.state.transitioning,
      onPin: () => host?.setCardPinned(true),
      onUnpin: () => host?.setCardPinned(false),
      onStart: () => {
        host?.setDrag(drag);
      },
      onFinish: () => {
        host?.setDrag(undefined);
      },
    });
  const deleteDialog = useDeleteEventDialog({
    event: () => props.event,
    onDeleted: () => props.onOpenChange(false),
  });
  const invites = createGuestInviteController(
    () => props.event,
    useCalendarGuestInvitesFlag(),
    useCalendarInvitationForwardFlag()
  );
  const canEdit = () => canEditCalendarEvent(props.event);
  const canDelete = () => canDeleteCalendarEvent(props.event);
  const openEditor = () => {
    const anchor = props.anchor;
    openEventComposer({
      event: props.event,
      anchorRect: () =>
        anchor.isConnected ? anchor.getBoundingClientRect() : undefined,
      returnFocus: anchor,
    });
    props.onOpenChange(false);
  };
  const forwardEventEmail = useForwardEventEmail();
  const forwardByEmail = () =>
    forwardEventEmail(props.event, {
      timeFormat: props.timeFormat,
      closeDetails: () => props.onOpenChange(false),
    });

  return (
    <Popover
      getAnchorRect={anchorRect}
      boundary={() => host?.boundary() ?? props.boundary}
      open
      onOpenChange={(open) => {
        // Keep the popover mounted while its delete dialog or guest editor
        // is open.
        if (
          !open &&
          (deleteDialog.isOpen() ||
            invites.editorOpen() ||
            invites.forwardEditorOpen())
        )
          return;
        props.onOpenChange(open);
        if (!open) host?.setCardPinned(false);
      }}
      placement="right-start"
      gutter={docked() ? 0 : 8}
      // Flip only to the other side, never to an end alignment: sections
      // that arrive after opening (join requests) change the
      // height, and an end fallback would re-place the popover from below
      // the event to above it. Slide keeps a tall popover in view instead.
      flip={!docked() && !drag.state.position && 'left-start'}
      slide={!docked() && !drag.state.position}
      overlap={!docked()}
      fitViewport
    >
      <Popover.Portal mount={host?.boundary() ?? props.boundary}>
        <Show when={drag.state.active && drag.target()}>
          {(bounds) => (
            <ComposerDropTarget
              bounds={bounds()}
              active={drag.state.overTarget}
            />
          )}
        </Show>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-modal max-w-[var(--kb-popper-content-available-width)] outline-none"
            onInteractOutside={(event) => {
              if (pinned()) event.preventDefault();
              else handleOpenEventOutsidePress(event);
            }}
            onOpenAutoFocus={(event) => {
              // Aims can arrive while the keyboard is elsewhere — arrow-key
              // scanning in the inbox previews a calendar notification here,
              // and auto-focusing the popover would silence the list's
              // navigation hotkeys (hotkey scope follows focus). Escape
              // still closes it from anywhere via the document listener.
              event.preventDefault();
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
            <Show when={!docked()}>
              <Popover.Arrow class="fill-surface" />
            </Show>
            <div
              ref={content}
              class="flex w-96 max-w-[calc(100vw-32px)] flex-col overflow-hidden menu-surface"
              style={{
                height: docked() ? `${dockRect()?.height ?? 0}px` : undefined,
                width: docked() ? `${dockRect()?.width ?? 384}px` : undefined,
                'max-height': `${maxHeight()}px`,
              }}
            >
              <Popover.Title class="sr-only">{props.event.title}</Popover.Title>
              <div
                class="flex shrink-0 cursor-grab touch-none select-none items-center justify-end gap-1 px-2 pt-2"
                onPointerDown={drag.start}
              >
                <div class="min-h-7 flex-1" />
                <Show when={host}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      pinned() ? 'Unpin event details' : 'Pin event details'
                    }
                    tooltip={
                      pinned() ? 'Unpin event details' : 'Pin event details'
                    }
                    aria-pressed={pinned()}
                    onClick={() => {
                      drag.reset();
                      host?.setCardPinned(!pinned());
                    }}
                  >
                    <SidePanelIcon class="size-4" />
                  </Button>
                </Show>
                <Show when={!props.event.teamProjection}>
                  <Button
                    aria-label="Copy event"
                    tooltip="Copy event"
                    variant="ghost"
                    size="icon-sm"
                    class="text-ink-muted"
                    onClick={() => copyCalendarEventMention(props.event)}
                  >
                    <LinkIcon class="size-4 shrink-0" />
                  </Button>
                  <Button
                    aria-label="Download .ics"
                    tooltip="Download .ics"
                    variant="ghost"
                    size="icon-sm"
                    class="text-ink-muted"
                    onClick={() => downloadCalendarEventIcs(props.event)}
                  >
                    <DownloadSimpleIcon class="size-4 shrink-0" />
                  </Button>
                  <Button
                    aria-label="Forward by email"
                    tooltip="Forward by email"
                    variant="ghost"
                    size="icon-sm"
                    class="text-ink-muted"
                    onClick={forwardByEmail}
                  >
                    <ArrowBendUpRightIcon class="size-4 shrink-0" />
                  </Button>
                </Show>
                <Show when={canEdit()}>
                  <Button
                    aria-label="Edit event"
                    tooltip="Edit event"
                    variant="ghost"
                    size="icon-sm"
                    class="text-ink-muted"
                    onClick={openEditor}
                  >
                    <PencilSimpleIcon class="size-4 shrink-0" />
                  </Button>
                </Show>
                <Show when={canDelete()}>
                  <Button
                    aria-label={deleteEventLabel(props.event)}
                    tooltip={deleteEventLabel(props.event)}
                    variant="ghost"
                    size="icon-sm"
                    class="text-ink-muted"
                    onClick={deleteDialog.open}
                  >
                    <TrashIcon class="size-4 shrink-0" />
                  </Button>
                </Show>
                {/* Kobalte names the button "Dismiss" unless it gets an aria-label. */}
                <Popover.CloseButton
                  as={Button}
                  aria-label="Close event details"
                  tooltip="Close event details"
                  variant="ghost"
                  size="icon-sm"
                  class="rounded-md text-ink-muted"
                >
                  <CloseIcon class="size-4 shrink-0" />
                </Popover.CloseButton>
              </div>
              <div class="min-h-0 flex-auto overflow-y-auto overscroll-contain">
                <EveryoneElseDeclinedNotice
                  event={props.event}
                  canEdit={canEdit()}
                  onDelete={deleteDialog.open}
                  onReschedule={openEditor}
                />
                <EventJoinRequests
                  eventId={props.event.eventId}
                  canModify={canEdit()}
                />
                <div class="px-3 pb-3">
                  <Show
                    when={props.event.teamProjection}
                    fallback={
                      <EventDetails
                        event={props.event}
                        timeFormat={props.timeFormat}
                        defaultReminders={props.defaultReminders}
                      />
                    }
                  >
                    <TeamEventDetails
                      event={props.event}
                      timeFormat={props.timeFormat}
                      onOpenLink={openExternalUrl}
                    />
                  </Show>
                </div>
                <Show when={!props.event.teamProjection}>
                  <EventGuests
                    event={props.event}
                    invites={invites}
                    closeDetails={() => props.onOpenChange(false)}
                  />
                </Show>
              </div>
              <div class="shrink-0">
                <Show when={!props.event.teamProjection}>
                  <EventRsvpSection event={props.event} />
                </Show>
              </div>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
