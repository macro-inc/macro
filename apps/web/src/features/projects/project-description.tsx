import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { CollabMarkdownEditor } from '@core/collab-surface/CollabMarkdownEditor';
import { Button } from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { createProductionProjectDescriptionSession } from './queries/production-project-description';

function DescriptionSession(props: {
  projectId: string;
  surfaceId: string;
  canEdit: boolean;
  onRetry(): void;
}) {
  const session = createProductionProjectDescriptionSession({
    projectId: props.projectId,
    surfaceId: props.surfaceId,
  });
  onCleanup(session.dispose);
  return (
    <>
      <CollabMarkdownEditor
        resolveAppLink={useMacroMentionLinkResolver()}
        sourceId={props.surfaceId}
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

/** Production adapter for the project's collaborative description surface. */
export function ProjectDescription(props: {
  projectId: string;
  surfaceId: string;
  canEdit: boolean;
}) {
  const [attempt, setAttempt] = createSignal(0);
  // Project refreshes re-read the same surface; only a new surface or retry reopens.
  const identity = createMemo(
    () => ({ surfaceId: props.surfaceId, attempt: attempt() }),
    undefined,
    {
      equals: (previous, next) =>
        previous.surfaceId === next.surfaceId &&
        previous.attempt === next.attempt,
    }
  );
  return (
    <Show when={identity().surfaceId ? identity() : undefined} keyed>
      {(identity) => (
        <DescriptionSession
          projectId={props.projectId}
          surfaceId={identity.surfaceId}
          canEdit={props.canEdit}
          onRetry={() => setAttempt((attempt) => attempt + 1)}
        />
      )}
    </Show>
  );
}
