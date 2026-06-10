import { Discussion, DiscussionProvider } from '@core/comments/discussion';
import { createDocumentDiscussionSource } from '../comments/documentDiscussionSource';

/** Task discussion: the document annotations source feeding the shared UI. */
export function TaskDiscussion() {
  const source = createDocumentDiscussionSource();
  return (
    <DiscussionProvider source={source}>
      <Discussion />
    </DiscussionProvider>
  );
}
