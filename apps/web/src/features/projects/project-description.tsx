import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useIsAuthenticated } from '@core/auth';
import { CollabMarkdownEditor } from '@core/collab-surface/CollabMarkdownEditor';
import type { SurfaceTokenViewer } from '@core/collab-surface/token';
import { useUserId } from '@core/context/user';
import { Button } from '@ui';
import { createMemo, createSignal, onCleanup, Show, Suspense } from 'solid-js';
import { ProjectDescriptionSkeleton } from './components/project-skeletons';
import { createProductionProjectDescriptionSession } from './queries/production-project-description';

function DescriptionSession(props: {
  projectId: string;
  viewer: SurfaceTokenViewer;
  canEdit: boolean;
  onRetry(): void;
}) {
  const session = createProductionProjectDescriptionSession(props.projectId, {
    viewer: props.viewer,
  });
  onCleanup(session.dispose);
  return (
    <Show
      when={!session.absent()}
      fallback={<p class="mt-1.5 text-base text-ink-muted">No description</p>}
    >
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
    </Show>
  );
}

/** Production adapter for the project's collaborative description surface. */
export function ProjectDescription(props: {
  projectId: string;
  canEdit: boolean;
}) {
  const authenticated = useIsAuthenticated();
  const userId = useUserId();
  const [attempt, setAttempt] = createSignal(0);
  // Project refreshes keep the same session; only a new project, a new
  // viewer, or a retry reopens. Opening waits for sign-in to settle: only an
  // account ensures the surface, and a token serves only the viewer it names.
  const viewer = (): SurfaceTokenViewer | undefined => {
    const signedIn = authenticated();
    if (signedIn === false) return null;
    if (signedIn) return userId();
    return undefined;
  };
  const identity = createMemo(
    () => {
      const current = viewer();
      return current === undefined
        ? undefined
        : { projectId: props.projectId, viewer: current, attempt: attempt() };
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.projectId === next?.projectId &&
        previous?.viewer === next?.viewer &&
        previous?.attempt === next?.attempt,
    }
  );
  return (
    <Suspense fallback={<ProjectDescriptionSkeleton />}>
      <Show when={identity()} keyed fallback={<ProjectDescriptionSkeleton />}>
        {(identity) => (
          <DescriptionSession
            projectId={identity.projectId}
            viewer={identity.viewer}
            canEdit={props.canEdit}
            onRetry={() => setAttempt((attempt) => attempt + 1)}
          />
        )}
      </Show>
    </Suspense>
  );
}
