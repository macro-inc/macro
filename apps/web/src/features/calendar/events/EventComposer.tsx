import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { emailToMacroId, useDisplayName } from '@core/user';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { createMemo, onMount, Show } from 'solid-js';
import { EventComposerForm } from './EventComposerForm';
import type { CalendarEvent } from './types';
import { useEventEditor } from './useEventEditor';

/** Standalone create/edit event composer hosted in a popover split. */
export function EventComposer(props: { event?: CalendarEvent }) {
  const panel = useSplitPanelOrThrow();
  const close = () => panel.handle.close();
  const editor = useEventEditor({
    event: () => props.event,
    onSaved: close,
  });

  const isEdit = () => props.event !== undefined;
  const organizerAttendee = props.event?.attendees.find(
    (candidate) => candidate.isOrganizer
  );
  const organizerEmail =
    props.event?.organizerEmail ?? organizerAttendee?.email;
  const organizerMacroId = organizerEmail
    ? emailToMacroId(organizerEmail)
    : undefined;
  const [macroOrganizerName] = useDisplayName(organizerMacroId);
  const organizer = createMemo(() => {
    if (!organizerEmail) return undefined;
    const macroName = macroOrganizerName().trim();
    const providerName = (
      props.event?.organizerName ?? organizerAttendee?.displayName
    )?.trim();
    const isUsableName = (name: string | undefined) =>
      name !== undefined &&
      name !== '' &&
      name !== organizerEmail &&
      !name.includes('@');

    return {
      email: organizerEmail,
      macroId: organizerMacroId,
      name: isUsableName(macroName)
        ? macroName
        : isUsableName(providerName)
          ? providerName
          : organizerEmail,
    };
  });

  const OrganizerMeta = () => (
    <Show when={organizer()} keyed>
      {(eventOrganizer) => (
        <div class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
          <Show
            when={eventOrganizer.macroId}
            fallback={
              <UserIcon email={eventOrganizer.email} size="sm" suppressClick />
            }
            keyed
          >
            {(macroId) => <UserIcon id={macroId} size="sm" suppressClick />}
          </Show>
          <span class="truncate text-ink">{eventOrganizer.name}</span>
          <span aria-hidden="true" class="shrink-0 text-ink-extra-muted">
            •
          </span>
          <span class="shrink-0 text-ink-extra-muted">Organizer</span>
        </div>
      )}
    </Show>
  );

  onMount(() =>
    panel.handle.setDisplayName(isEdit() ? 'Edit event' : 'New event')
  );

  return (
    <div class="portal-scope flex h-full min-h-0 flex-col gap-3 p-4 text-ink">
      <div class="flex shrink-0 items-center justify-end">
        <Button
          class="ml-auto"
          aria-label={
            isEdit() ? 'Close event editor' : 'Close new event composer'
          }
          variant="ghost"
          size="icon-sm"
          disabled={editor.pending()}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>

      <EventComposerForm
        initialValues={editor.initialValues()}
        disabledFields={editor.disabledFields}
        calendarOptions={editor.calendarOptions()}
        guestOptions={editor.guestOptions}
        showRecurringEditNotice={editor.showRecurringEditNotice()}
        titleMeta={<OrganizerMeta />}
        pending={editor.pending()}
        onCancel={close}
        onSubmit={editor.save}
      />
    </div>
  );
}
