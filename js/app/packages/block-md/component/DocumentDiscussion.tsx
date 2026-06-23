import { Discussion, DiscussionProvider } from '@core/comments/discussion';
import { createDocumentDiscussionSource } from '../comments/documentDiscussionSource';

/** Document discussion: the document annotations source feeding the shared UI. */
export function DocumentDiscussion() {
  const source = createDocumentDiscussionSource();
  return (
    <DiscussionProvider source={source}>
      <Discussion />
    </DiscussionProvider>
  );
}
