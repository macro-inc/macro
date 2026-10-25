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
import { Popover } from '@kobalte/core/popover';
import CopyIcon from '@phosphor/copy.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import type { CalendarInviteScope } from '@service-email/client';
import { Button, Checkbox, Dialog, Layer, Tabs } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

/** Same wording as the RSVP and delete scope choices. */
const INVITE_SCOPE_OPTIONS = [
  { value: 'this_event', label: 'This event' },
  { value: 'all', label: 'All events' },
] satisfies { value: CalendarInviteScope; label: string }[];

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
  const contacts = useContacts();
  const options = createMemo<EventEditorGuestOption[]>(() =>
    contacts().map(recipientEntityMapper('user'))
  );
  const current = createMemo(() =>
    initialGuestOptions(
      props.event.attendees.map((attendee) => attendee.email).join(', '),
      options()
    )
  );
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
      // Registered on the element so it runs before the picker's document
      // listener, which adds the highlighted suggestion on every Enter.
      on:keydown={(event) => {
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
      }}
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
          variant="strong"
          size="sm"
          depth={3}
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

/**
 * The attendees header's "Add guests" action and the editor it opens,
 * anchored to the action on desktop and a bottom sheet on phones.
 */
function EventInviteGuestsAction(props: {
  event: CalendarEvent;
  invites: GuestInviteController;
}) {
  const close = () => props.invites.setEditorOpen(false);
  const form = () => (
    <InviteGuestsForm
      event={props.event}
      onSend={props.invites.send}
      onClose={close}
    />
  );

  return (
    <Show
      when={isMobile()}
      fallback={
        <Popover
          open={props.invites.editorOpen()}
          onOpenChange={props.invites.setEditorOpen}
          placement="bottom-end"
          gutter={4}
          flip
          slide
        >
          <Popover.Trigger
            as={Button}
            label="Add guests"
            variant="ghost"
            size="icon-sm"
            depth={3}
            class="text-ink-muted [&_svg]:size-4"
          >
            <UserPlusIcon />
          </Popover.Trigger>
          <EventComposerPopoverPortal>
            <Layer depth={3}>
              <Popover.Content class="menu-surface z-action-menu flex max-h-[min(30rem,var(--kb-popper-content-available-height,30rem))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden text-sm menu-open-animation">
                <Popover.Title class="sr-only">Add guests</Popover.Title>
                {form()}
              </Popover.Content>
            </Layer>
          </EventComposerPopoverPortal>
        </Popover>
      }
    >
      <Button
        label="Add guests"
        variant="ghost"
        size="icon-sm"
        depth={3}
        class="text-ink-muted [&_svg]:size-4"
        onClick={() => props.invites.setEditorOpen(true)}
      >
        <UserPlusIcon />
      </Button>
      <Dialog
        open={props.invites.editorOpen()}
        onOpenChange={props.invites.setEditorOpen}
      >
        <Dialog.Title class="px-4 pb-2 text-base font-semibold text-ink">
          Add guests
        </Dialog.Title>
        {form()}
      </Dialog>
    </Show>
  );
}

/**
 * The guest-row actions Google Calendar users know: copy every guest's
 * address and start an email to the other guests (both hidden when the
 * viewer is the only one, as on a snapshot, and copying while the organizer
 * hides the guest list, which the copy does not hold), or add guests when the
 * organizer allows it. Emailing closes the details first: closing hands focus
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
            label="Copy guest emails"
            variant="ghost"
            size="icon-sm"
            depth={3}
            class="text-ink-muted [&_svg]:size-4"
            onClick={() => copyGuestEmails(guestEmails(props.event.attendees))}
          >
            <CopyIcon />
          </Button>
        </Show>
        <Button
          label="Email guests"
          variant="ghost"
          size="icon-sm"
          depth={3}
          class="text-ink-muted [&_svg]:size-4"
          onClick={() => {
            const event = props.event;
            props.closeDetails();
            openEventEmail(event);
          }}
        >
          <EnvelopeIcon />
        </Button>
      </Show>
      <Show when={props.invites.canInvite()}>
        <EventInviteGuestsAction event={props.event} invites={props.invites} />
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
