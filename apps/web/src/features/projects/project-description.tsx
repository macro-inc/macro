import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { CollabMarkdownEditor } from '@core/collab-surface/CollabMarkdownEditor';
import { Button } from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { createProductionProjectDescriptionSession } from './queries/production-project-description';

function DescriptionSession(props: {
  documentId: string;
  canEdit: boolean;
  onRetry(): void;
}) {
  const session = createProductionProjectDescriptionSession(props.documentId);
  onCleanup(session.dispose);
  return (
    <>
      <CollabMarkdownEditor
        resolveAppLink={useMacroMentionLinkResolver()}
        sourceId={props.documentId}
        session={session}
        canEdit={() => props.canEdit}
        canComment={() => false}
        label="Project description"
        namespace="project-description"
        class="min-h-24 text-sm"
        placeholder={props.canEdit ? 'Add a description…' : 'No description'}
      />
      <Show when={session.connectionError()}>
        <Button size="sm" onClick={props.onRetry}>
          Retry description
        </Button>
      </Show>
    </>
  );
}

/** Production adapter for the existing description document's collaboration session. */
export function ProjectDescription(props: {
  documentId: string;
  canEdit: boolean;
}) {
  const [attempt, setAttempt] = createSignal(0);
  // Project refreshes re-read the same documentId; only a new id or retry reopens.
  const identity = createMemo(
    () => ({ documentId: props.documentId, attempt: attempt() }),
    undefined,
    {
      equals: (previous, next) =>
        previous.documentId === next.documentId &&
        previous.attempt === next.attempt,
    }
  );
  return (
    <Show when={identity()} keyed>
      {(identity) => (
        <DescriptionSession
          documentId={identity.documentId}
          canEdit={props.canEdit}
          onRetry={() => setAttempt((attempt) => attempt + 1)}
        />
      )}
    </Show>
  );
}
