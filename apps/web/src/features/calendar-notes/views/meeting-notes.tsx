import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { NoteDialog } from '../components/note-dialog';
import { NotesSection } from '../components/notes-section';
import type { NotesSource } from '../context/notes-source';
import type { MeetingNote } from '../core/types';
import { createMeetingNoteAction } from '../primitives/create-meeting-note';
import { createNotesController } from '../primitives/notes-controller';

export function MeetingNotesView(props: {
  source: NotesSource;
  eventTitle: string;
  recurring: boolean;
  guestListHidden?: boolean;
  onOpen: (note: MeetingNote) => void;
  onDialogChange: (open: boolean) => void;
}) {
  const controller = createNotesController(props.source, props.onDialogChange);
  const creation = createMeetingNoteAction({
    source: props.source,
    title: () => props.eventTitle,
    onOpen: (document) => props.onOpen({ ...document, canManage: true }),
  });
  return (
    <>
      <NotesSection
        state={props.source.notes()}
        creating={creation.pending()}
        createdUnlinked={!!creation.saved()}
        createError={creation.error()}
        onCreate={() => fireAndForget(creation.run(), 'calendar.notes.create')}
        onOpenSaved={creation.openSaved}
        dialogOpen={!!controller.dialog()}
        onMenuChange={controller.setMenuOpen}
        onLink={controller.openLink}
        onOpen={props.onOpen}
        onSharing={controller.openSharing}
        onUnlink={controller.openUnlink}
        onRetry={() =>
          fireAndForget(props.source.retry(), 'calendar.notes.retry')
        }
      />
      <Show when={controller.dialog()}>
        {(dialog) => (
          <NoteDialog
            kind={dialog().kind}
            eventTitle={props.eventTitle}
            recurring={props.recurring}
            guestListHidden={props.guestListHidden}
            picker={controller.picker()}
            query={controller.query()}
            onQuery={controller.setQuery}
            selected={controller.selected()}
            onSelect={controller.setSelected}
            linkedIds={
              props.source.notes().data?.map((note) => note.documentId) ?? []
            }
            teamId={controller.teamId()}
            currentTeam={(() => {
              const active = dialog();
              return active.kind === 'link' ? undefined : active.note.team;
            })()}
            onTeam={controller.setTeamId}
            saving={controller.saving()}
            error={controller.error()}
            onSave={() =>
              fireAndForget(controller.save(), 'calendar.notes.save')
            }
            onClose={controller.close}
          />
        )}
      </Show>
    </>
  );
}
