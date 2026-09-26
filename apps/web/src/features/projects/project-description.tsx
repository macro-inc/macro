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
  const identity = createMemo(() => ({
    documentId: props.documentId,
    attempt: attempt(),
  }));
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
