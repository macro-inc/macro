import { useUserId } from '@core/context/user';
import { createEffect, Show, Suspense } from 'solid-js';
import type { MeetingAccessState } from './core/types';
import { createDocumentNotesSource } from './queries/notes-source';
import { DocumentNotesView } from './views/document-notes';

/** Owner-only meeting grants within the document share panel. */
export function DocumentMeetingNotes(props: {
  documentId: string;
  onAccessState?: (state: MeetingAccessState) => void;
}) {
  const userId = useUserId();
  const source = createDocumentNotesSource(userId, () => props.documentId);
  createEffect(() => {
    const state = source.links();
    props.onAccessState?.(
      state.error
        ? 'error'
        : !state.data
          ? 'loading'
          : state.data.length
            ? 'shared'
            : 'none'
    );
  });
  return (
    <Suspense>
      <Show when={JSON.stringify([userId(), props.documentId])} keyed>
        {(_identity) => <DocumentNotesView source={source} />}
      </Show>
    </Suspense>
  );
}
