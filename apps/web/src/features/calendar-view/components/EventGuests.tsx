import { EventComposerPopoverPortal } from '@app/features/calendar/components/composer/EventComposerPopoverPortal';
import {
  AddOnlyGuestsEditor,
  guestDisplayName,
} from '@app/features/calendar/components/composer/EventGuestsEditor';
import {
  type EventEditorGuestOption,
  guestEmail,
  initialGuestOptions,
  type SelectedEventEditorGuest,
} from '@app/features/calendar/components/composer/event-form-model';
import { EventAttendeesSection } from '@app/features/calendar/components/EventDetails';
import type {
  GuestInvitation,
  GuestInviteController,
  InvitationForward,
} from '@app/features/calendar/hooks/create-guest-invite-controller';
import type { CalendarEvent } from '@app/features/calendar/types';
import { guestListHidden } from '@app/features/calendar/utils/event-guest-editing';
import {
  eventEmailRecipients,
  guestEmails,
} from '@app/features/calendar/utils/guest-emails';
import { useOpenEventEmail } from '@app/features/calendar-view/components/use-open-event-email';
import { copyGuestEmails } from '@app/features/calendar-view/copy-guest-emails';
import { isMobile } from '@core/mobile/isMobile';
import { recipientEntityMapper, useContacts } from '@core/user';
import CopyIcon from '@icon/system/regular/copy.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PaperPlaneTiltIcon from '@icon/system/regular/paper-plane-tilt.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import { Popover } from '@kobalte/core/popover';
import type { CalendarInviteScope } from '@service-email/client';
import { Button, Checkbox, Dialog, Layer, Tabs } from '@ui';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';

/** Same wording as the RSVP and delete scope choices. */
const INVITE_SCOPE_OPTIONS = [
  { value: 'this_event', label: 'This event' },
  { value: 'all', label: 'All events' },
] satisfies { value: CalendarInviteScope; label: string }[];

/** The viewer's contacts as guest options, and the event's guests among them. */
function createGuestOptions(event: () => CalendarEvent) {
  const contacts = useContacts();
  const options = createMemo<EventEditorGuestOption[]>(() =>
    contacts().map(recipientEntityMapper('user'))
  );
  const current = createMemo(() =>
    initialGuestOptions(
      event()
        .attendees.map((attendee) => attendee.email)
        .join(', '),
      options()
    )
  );
  return { options, current };
}

/**
 * A guest form's keys: Cmd/Ctrl+Enter sends. Registered on the element so it
 * runs before the picker's document listener, which adds the highlighted
 * suggestion on every Enter, and Enter outside the picker's text field does
 * not reach it.
 */
function guestFormKeydown(send: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      send();
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLInputElement && target.type === 'text')) {
      event.stopPropagation();
    }
  };
}

/**
 * The composer's add-only guest editor, plus what an invitation from event
 * details needs: an Optional choice per new guest, the occurrence scope of a
 * recurring event, and the send button.
 */
function InviteGuestsForm(props: {
  event: CalendarEvent;
  onSend: (invitation: GuestInvitation) => void;
  onClose: () => void;
}) {
  const { options, current } = createGuestOptions(() => props.event);
  const [added, setAdded] = createSignal<SelectedEventEditorGuest[]>([]);
  const [optionalIds, setOptionalIds] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  // A recurring event invites to the whole series unless the viewer narrows
  // it, as the composer's edits do.
  const [scope, setScope] = createSignal<CalendarInviteScope>('all');
  const recurring = () =>
    props.event.recurrenceLines.length > 0 ||
    props.event.recurrenceId !== undefined;

  const setOptional = (guest: SelectedEventEditorGuest, optional: boolean) => {
    const next = new Set(optionalIds());
    if (optional) next.add(guest.id);
    else next.delete(guest.id);
    setOptionalIds(next);
  };
  const send = () => {
    if (added().length === 0) return;
    props.onSend({
      guests: added().map((guest) => ({
        email: guestEmail(guest),
        name: guestDisplayName(guest),
        optional: optionalIds().has(guest.id),
      })),
      scope: recurring() ? scope() : 'all',
    });
  };

  return (
    <div
      class="flex min-h-0 flex-1 flex-col"
      on:keydown={guestFormKeydown(send)}
    >
      <AddOnlyGuestsEditor
        options={options}
        current={current()}
        added={added()}
        onAddedChange={setAdded}
        onClose={props.onClose}
        addedControls={(guest) => (
          <Checkbox
            checked={optionalIds().has(guest.id)}
            onChange={(optional) => setOptional(guest, optional)}
            class="shrink-0"
          >
            <Checkbox.Control />
            <Checkbox.Label class="text-xs text-ink-muted">
              Optional
            </Checkbox.Label>
          </Checkbox>
        )}
      />
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge-muted p-2">
        <Show when={recurring()}>
          <Tabs
            touch="segmented"
            aria-label="Invite to"
            size="sm"
            value={scope()}
            options={INVITE_SCOPE_OPTIONS}
            onChange={setScope}
          />
        </Show>
        <Button
          variant="secondary"
          size="sm"
          class="ml-auto"
          disabled={added().length === 0}
          onClick={send}
        >
          Send invitations
        </Button>
      </div>
    </div>
  );
}

/** Shown above the forward button; Google says the same of its own forward. */
const FORWARD_FORM_NOTE =
  "They can add the event to their calendar but won't appear in the guest list.";

/**
 * Forwarding the invitation, for a guest who cannot add guests: the same
 * add-only picker as Add guests, for people who get the event by email
 * instead of a place on the guest list. A forward covers the whole series,
 * since the file it sends is the series.
 */
function ForwardInvitationForm(props: {
  event: CalendarEvent;
  onSend: (forward: InvitationForward) => void;
  onClose: () => void;
}) {
  const { options, current } = createGuestOptions(() => props.event);
  const [added, setAdded] = createSignal<SelectedEventEditorGuest[]>([]);
  const send = () => {
    if (added().length === 0) return;
    props.onSend({
      recipients: added().map((guest) => ({
        email: guestEmail(guest),
        name: guestDisplayName(guest),
      })),
    });
  };

  return (
    <div
      class="flex min-h-0 flex-1 flex-col"
      on:keydown={guestFormKeydown(send)}
    >
      <AddOnlyGuestsEditor
        options={options}
        current={current()}
        added={added()}
        onAddedChange={setAdded}
        onClose={props.onClose}
        addedLabel="Forward to"
      />
      <div class="flex shrink-0 items-center gap-2 border-t border-edge-muted p-2">
        <p class="min-w-0 flex-1 text-xs text-ink-muted">{FORWARD_FORM_NOTE}</p>
        <Button
          variant="secondary"
          size="sm"
          class="shrink-0"
          disabled={added().length === 0}
          onClick={send}
        >
          Forward
        </Button>
      </div>
    </div>
  );
}

/**
 * An attendees-header action and the guest editor it opens, anchored to the
 * action on desktop and a bottom sheet on phones.
 */
function GuestEditorAction(props: {
  label: string;
  icon: JSX.Element;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <Show
      when={isMobile()}
      fallback={
        <Popover
          open={props.open}
          onOpenChange={props.onOpenChange}
          placement="bottom-end"
          gutter={4}
          // Flip only to the other side, and let overlap slide it up over its
          // button when neither side fits. Overlap also sizes the editor to
          // the whole window rather than the room below: sized to that room,
          // it never overflowed, so it never flipped, and suggestions that
          // arrived after it opened squeezed the chosen people to nothing.
          flip="top-end"
          slide
          overlap
        >
          <Popover.Trigger
            aria-label={props.label}
            tooltip={props.label}
            as={Button}
            variant="ghost"
            size="icon-sm"
            class="text-ink-muted"
          >
            {props.icon}
          </Popover.Trigger>
          <EventComposerPopoverPortal>
            <Layer depth={3}>
              <Popover.Content class="menu-surface z-action-menu flex max-h-[min(30rem,var(--kb-popper-content-available-height,30rem))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden text-sm menu-open-animation">
                <Popover.Title class="sr-only">{props.label}</Popover.Title>
                {props.children}
              </Popover.Content>
            </Layer>
          </EventComposerPopoverPortal>
        </Popover>
      }
    >
      <Button
        aria-label={props.label}
        tooltip={props.label}
        variant="ghost"
        size="icon-sm"
        class="text-ink-muted"
        onClick={() => props.onOpenChange(true)}
      >
        {props.icon}
      </Button>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <Dialog.Title class="px-4 pb-2 text-base font-semibold text-ink">
          {props.label}
        </Dialog.Title>
        {props.children}
      </Dialog>
    </Show>
  );
}

/** The attendees header's "Add guests" action and its editor. */
function EventInviteGuestsAction(props: {
  event: CalendarEvent;
  invites: GuestInviteController;
}) {
  return (
    <GuestEditorAction
      label="Add guests"
      icon={<UserPlusIcon class="size-4 shrink-0" />}
      open={props.invites.editorOpen()}
      onOpenChange={props.invites.setEditorOpen}
    >
      <InviteGuestsForm
        event={props.event}
        onSend={props.invites.send}
        onClose={() => props.invites.setEditorOpen(false)}
      />
    </GuestEditorAction>
  );
}

/**
 * The attendees header's "Forward invitation" action, where Add guests
 * would be if the viewer could invite, and its editor.
 */
export function EventForwardInvitationAction(props: {
  event: CalendarEvent;
  invites: GuestInviteController;
}) {
  return (
    <GuestEditorAction
      label="Forward invitation"
      icon={<PaperPlaneTiltIcon class="size-4 shrink-0" />}
      open={props.invites.forwardEditorOpen()}
      onOpenChange={props.invites.setForwardEditorOpen}
    >
      <ForwardInvitationForm
        event={props.event}
        onSend={props.invites.forward}
        onClose={() => props.invites.setForwardEditorOpen(false)}
      />
    </GuestEditorAction>
  );
}

/**
 * The guest-row actions Google Calendar users know: copy every guest's
 * address and start an email to the other guests (both hidden when the
 * viewer is the only one, as on a snapshot, and copying while the organizer
 * hides the guest list, which the copy does not hold), add guests when the
 * organizer allows it, or else forward the invitation. Emailing closes the details first: closing hands focus
 * back to the calendar chip, and the composer's To field has to win that
 * exchange.
 */
function EventGuestActions(props: {
  event: CalendarEvent;
  invites: GuestInviteController;
  closeDetails: () => void;
}) {
  const openEventEmail = useOpenEventEmail();

  return (
    <Show when={!props.event.teamProjection}>
      <Show when={eventEmailRecipients(props.event).length > 0}>
        <Show when={!guestListHidden(props.event)}>
          <Button
            aria-label="Copy guest emails"
            tooltip="Copy guest emails"
            variant="ghost"
            size="icon-sm"
            class="text-ink-muted"
            onClick={() => copyGuestEmails(guestEmails(props.event.attendees))}
          >
            <CopyIcon class="size-4 shrink-0" />
          </Button>
        </Show>
        <Button
          aria-label="Email guests"
          tooltip="Email guests"
          variant="ghost"
          size="icon-sm"
          class="text-ink-muted"
          onClick={() => {
            const event = props.event;
            props.closeDetails();
            openEventEmail(event);
          }}
        >
          <EnvelopeIcon class="size-4 shrink-0" />
        </Button>
      </Show>
      <Show when={props.invites.canInvite()}>
        <EventInviteGuestsAction event={props.event} invites={props.invites} />
      </Show>
      <Show when={props.invites.canForward()}>
        <EventForwardInvitationAction
          event={props.event}
          invites={props.invites}
        />
      </Show>
    </Show>
  );
}

/** The attendees section with its header actions and explanation. */
export function EventGuests(props: {
  event: CalendarEvent;
  invites: GuestInviteController;
  closeDetails: () => void;
}) {
  return (
    <EventAttendeesSection
      attendees={props.event.attendees}
      guestListHidden={guestListHidden(props.event)}
      notice={props.invites.restrictedReason()}
      actions={
        <EventGuestActions
          event={props.event}
          invites={props.invites}
          closeDetails={props.closeDetails}
        />
      }
    />
  );
}
