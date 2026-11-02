import type { Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type {
  DocumentNoteLink,
  MeetingNote,
  NoteCreateFailure,
  NoteDocument,
  NoteFailure,
  NotePicker,
  NoteRead,
  NoteTarget,
} from '../core/types';

/** Reactive reads and writes owned by the calendar-note feature. */
export type NotesSource = {
  notes: Accessor<NoteRead<MeetingNote[]>>;
  create: (name: string) => Promise<Result<NoteDocument, NoteCreateFailure>>;
  picker: (
    query: Accessor<string>,
    enabled: Accessor<boolean>
  ) => Accessor<NoteRead<NotePicker>>;
  retry: () => Promise<unknown>;
  link: (
    documentId: string,
    teamId?: string
  ) => Promise<Result<void, NoteFailure>>;
  unlink: (documentId: string) => Promise<Result<void, NoteFailure>>;
};

export type DocumentNotesSource = {
  links: Accessor<NoteRead<DocumentNoteLink[]>>;
  retry: () => Promise<unknown>;
  unlink: (target: NoteTarget) => Promise<Result<void, NoteFailure>>;
};
