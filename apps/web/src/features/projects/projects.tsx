import { listOwnedSlotName } from '@app/components/list/owned-slots';
import { ShowFeatureFlag, useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { enableProjects } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { registerActivityRevalidator } from '@queries/activity/push-registry';
import { queryClient } from '@queries/client';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { initiativeClient } from '@service-storage/initiative';
import { Button } from '@ui';
import type { Accessor } from 'solid-js';
import { ErrorBoundary, onCleanup, type ParentProps, Suspense } from 'solid-js';
import {
  ProjectsProvider,
  useProjectsContext,
} from './context/projects-context';
import {
  createProjectCollection,
  type ProjectListActivation,
} from './primitives/project-collection';
import { createProjectCollectionPersistence } from './project-collection-persistence';
import { projectKeys } from './queries/keys';
import { createProjectSources } from './queries/project-sources';
import { observeProjectTaskChanges } from './queries/project-task-revalidation';
import { ProjectAssignment } from './views/project-assignment';
import { ProjectsCollection } from './views/projects-collection';

function createProjectReadGate() {
  // Each source invokes this under its own owner, which can outlive this view.
  const flag = useFeatureFlag(enableProjects);
  return () => flag().enabled;
}

function createProjectsContext() {
  const userId = useUserId();
  onCleanup(
    registerActivityRevalidator({
      client: getGraphqlSoupClient,
      // Multiple mounted surfaces share an in-flight refresh instead of cancelling it.
      refresh: () =>
        queryClient.invalidateQueries(
          { queryKey: projectKeys._def },
          { cancelRefetch: false }
        ),
    })
  );
  return createProjectSources(
    initiativeClient,
    queryClient,
    userId,
    (source) => observeProjectTaskChanges(getGraphqlSoupClient, source),
    createProjectReadGate
  );
}

export function Projects(props: ParentProps) {
  return (
    <ShowFeatureFlag flag={enableProjects}>
      <ProjectsContent>{props.children}</ProjectsContent>
    </ShowFeatureFlag>
  );
}

function ProjectsContent(props: ParentProps) {
  const context = createProjectsContext();
  return (
    <ErrorBoundary
      fallback={(_, reset) => (
        <div role="alert" class="p-4">
          Could not load projects. <Button onClick={reset}>Try again</Button>
        </div>
      )}
    >
      <Suspense
        fallback={
          <div role="status" class="p-4 text-ink-muted">
            Loading projects…
          </div>
        }
      >
        <ProjectsProvider context={context}>{props.children}</ProjectsProvider>
      </Suspense>
    </ErrorBoundary>
  );
}

export function ProjectsTab(props: {
  onOpen: (id: string, event?: MouseEvent, newSplit?: boolean) => void;
}) {
  return (
    <Projects>
      <ProjectsCollectionHost {...props} />
    </Projects>
  );
}

function ProjectsCollectionHost(props: {
  onOpen: (id: string, event?: MouseEvent, newSplit?: boolean) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const context = useProjectsContext();
  const activation = withSplitPanelOwner(
    listOwnedSlotName('initiatives:activation'),
    () => ({
      current: undefined as
        | ((id: string, metadata?: ProjectListActivation) => void)
        | undefined,
    })
  );
  const open = (id: string, metadata?: ProjectListActivation) =>
    props.onOpen(id, metadata?.event, metadata?.newSplit);
  activation.current = open;
  onCleanup(() => {
    if (activation.current === open) activation.current = undefined;
  });
  const collection = withSplitPanelOwner(
    listOwnedSlotName('initiatives:collection'),
    () =>
      createProjectCollection({
        ...createProjectCollectionPersistence(panel.handle),
        createSource: context.createCollectionSource,
        userId: context.userId,
        onOpen: (id, metadata) => activation.current?.(id, metadata),
      })
  );
  return (
    <ProjectsCollection
      onOpen={open}
      collection={collection}
      onCreate={() =>
        layout.popoverSplit({ type: 'component', id: 'project-compose' })
      }
      scopeId={panel.splitHotkeyScope}
      isActive={panel.isPanelActive}
    />
  );
}

export function ProjectAssignmentDialog(props: {
  taskIds: readonly string[];
  onClose(): void;
}) {
  return (
    <Projects>
      <ProjectAssignment taskIds={props.taskIds} onClose={props.onClose} />
    </Projects>
  );
}

export function useTaskProjectReferences(ids: Accessor<readonly string[]>) {
  return createProjectsContext().createReferencesSource(ids);
}
