import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { CollabMarkdownEditor } from '@core/collab-surface/CollabMarkdownEditor';
import { Button } from '@ui';
import { createMemo, createSignal, onCleanup, Show, Suspense } from 'solid-js';
import { ProjectDescriptionSkeleton } from './components/project-skeletons';
import { createProductionProjectDescriptionSession } from './queries/production-project-description';

function DescriptionSession(props: {
  projectId: string;
  canEdit: boolean;
  onRetry(): void;
}) {
  const session = createProductionProjectDescriptionSession(props.projectId);
  onCleanup(session.dispose);
  return (
    <>
      <CollabMarkdownEditor
        resolveAppLink={useMacroMentionLinkResolver()}
        sourceId={props.projectId}
        session={session}
        canEdit={() => props.canEdit}
        canComment={() => false}
        label="Project description"
        namespace="project-description"
        class="min-h-24 mt-1.5 text-base"
        loadingFallback={<ProjectDescriptionSkeleton />}
        placeholder={
          props.canEdit
            ? "Add a description. Press '/' for commands, '@' to mention…"
            : 'No description'
        }
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
  canEdit: boolean;
}) {
  const [attempt, setAttempt] = createSignal(0);
  // Project refreshes keep the same session; only a new project or retry reopens.
  const identity = createMemo(
    () => ({ projectId: props.projectId, attempt: attempt() }),
    undefined,
    {
      equals: (previous, next) =>
        previous.projectId === next.projectId &&
        previous.attempt === next.attempt,
    }
  );
  return (
    <Suspense fallback={<ProjectDescriptionSkeleton />}>
      <Show when={identity()} keyed>
        {(identity) => (
          <DescriptionSession
            projectId={identity.projectId}
            canEdit={props.canEdit}
            onRetry={() => setAttempt((attempt) => attempt + 1)}
          />
        )}
      </Show>
    </Suspense>
  );
}
