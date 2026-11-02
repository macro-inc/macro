import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { type Accessor, createMemo } from 'solid-js';
import type { NoteDocumentSearch } from '../context/notes-source';

export function createLocalNoteSearch(
  quickAccess: QuickAccessContextValue,
  userId: Accessor<string | undefined>
): NoteDocumentSearch {
  return (query, enabled) => {
    const list = quickAccess.useList({
      buckets: ['note', 'task', 'snippet', 'skill'],
      searchTerm: query,
      enabled,
    });
    return createMemo(() => {
      const owner = userId();
      if (!owner || !enabled()) return [];
      return list
        .items()
        .flatMap(({ data }) =>
          data.ownerId === owner
            ? [{ documentId: data.id, name: data.name }]
            : []
        );
    });
  };
}
