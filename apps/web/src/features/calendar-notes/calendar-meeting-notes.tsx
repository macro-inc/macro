import { Permissions } from '@core/component/SharePermissions';
import { ShareModal } from '@core/component/TopBar/ShareButton';
import { useUserId } from '@core/context/user';
import { Show, Suspense } from 'solid-js';
import type { CalendarEvent } from '../calendar/types';
import { createNotesSource } from './queries/notes-source';
import { MeetingNotesView } from './views/meeting-notes';

/** App composition; the view and controller also mount without calendar chrome. */
export function CalendarMeetingNotes(props: {
  event: CalendarEvent;
  onOpenDocument: (documentId: string) => void;
  onDialogChange: (open: boolean) => void;
}) {
  const userId = useUserId();
  const source = createNotesSource(userId, () => ({
    eventId: props.event.eventId,
    occurrenceKey: props.event.occurrenceKey,
  }));
  return (
    <Suspense>
      <Show
        when={JSON.stringify([
          userId(),
          props.event.eventId,
          props.event.occurrenceKey,
        ])}
        keyed
      >
        {(_identity) => (
          <MeetingNotesView
            source={source}
            eventTitle={props.event.title}
            recurring={props.event.recurrenceLines.length > 0}
            guestListHidden={!props.event.guestPolicy.canSeeOtherGuests}
            onOpen={(note) => props.onOpenDocument(note.documentId)}
            shareDialog={(note, onClose) => (
              <Suspense>
                <ShareModal
                  open
                  onOpenChange={(open) => {
                    if (!open) onClose();
                  }}
                  id={note.documentId}
                  itemType="document"
                  blockAlias="md"
                  name={note.name}
                  owner={userId()}
                  userPermissions={Permissions.OWNER}
                />
              </Suspense>
            )}
            onDialogChange={props.onDialogChange}
          />
        )}
      </Show>
    </Suspense>
  );
}
