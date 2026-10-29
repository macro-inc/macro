import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { NoteTarget } from '../core/types';

export const notesKeys = createQueryKeys('calendar-notes', {
  notes: (userId: string | undefined, target: NoteTarget) => [userId, target],
  documents: (userId: string | undefined, query: string) => [userId, query],
  documentLinks: (userId: string | undefined, documentId: string) => [
    userId,
    documentId,
  ],
});
