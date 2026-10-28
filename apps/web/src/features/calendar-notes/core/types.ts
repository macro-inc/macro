export type NoteDocument = { documentId: string; name: string };
export type NoteTeam = { id: string; name: string };
export type MeetingNote = NoteDocument & {
  team?: NoteTeam;
  canManage: boolean;
};
export type NotePicker = { documents: NoteDocument[]; teams: NoteTeam[] };
export type NoteTarget = { eventId: string; occurrenceKey: string };
export type DocumentNoteLink = NoteTarget & {
  eventTitle: string;
  team?: NoteTeam;
};
export type MeetingAccessState = 'loading' | 'shared' | 'none' | 'error';
export type NoteFailure =
  | { kind: 'link_failed'; message: string }
  | { kind: 'unlink_failed'; message: string };

export type NoteCreateFailure =
  | { kind: 'create_failed'; message: string }
  | { kind: 'created_unlinked'; message: string; document: NoteDocument };

export type NoteRead<T> = {
  data?: T;
  pending: boolean;
  error?: string;
};
