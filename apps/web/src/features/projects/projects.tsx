import { listOwnedSlotName } from '@app/components/list/owned-slots';
import {
  makeCopyEntityIdAction,
  makeCopyLinkAction,
} from '@app/features/next-soup/actions';
import { ShowFeatureFlag, useFeatureFlag } from '@app/lib/analytics/posthog';
import { createSearchParams } from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { enableProjects } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import { registerActivityRevalidator } from '@queries/activity/push-registry';
import { queryClient } from '@queries/client';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { initiativeClient } from '@service-storage/initiative';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  ErrorBoundary,
  on,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import {
  ProjectsProvider,
  useProjectsContext,
} from './context/projects-context';
import { projectRouteId } from './core/route';
import {
  createProjectCollection,
  type ProjectListActivation,
} from './primitives/project-collection';
import { createProjectCollectionPersistence } from './project-collection-persistence';
import { projectCollectionSearch } from './project-collection-search';
import { ProjectShareLauncher } from './project-share';
import { projectKeys } from './queries/keys';
import { createProjectSources } from './queries/project-sources';
import { ProjectAssignment } from './views/project-assignment';
import { ProjectsCollection } from './views/projects-collection';
import {
  ProjectsSidebar,
  type ProjectsSidebarProps,
} from './views/projects-sidebar';

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
    { client: getGraphqlSoupClient },
    queryClient,
    userId,
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

export function ProjectsSidebarSection(props: ProjectsSidebarProps) {
  return (
    <Projects>
      <ProjectsSidebar {...props} />
    </Projects>
  );
}

function ProjectsCollectionHost(props: {
  onOpen: (id: string, event?: MouseEvent, newSplit?: boolean) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const context = useProjectsContext();
  const [search, setSearch] = createSearchParams(projectCollectionSearch);
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
  // URL history restores the entry snapshot, not the latest layout selection.
  const entryLayout = collection.layout();
  createEffect(
    on(
      () => search.layout,
      (layout) => collection.setLayout(layout ?? entryLayout)
    )
  );
  const displayCollection = {
    ...collection,
    setLayout: (layout: 'list' | 'gantt') => {
      const selected = collection.setLayout(layout);
      setSearch({ layout: selected });
      return selected;
    },
  };
  const copyLink = makeCopyLinkAction();
  const copyId = makeCopyEntityIdAction();
  const [sharing, setSharing] = createSignal<string>();
  return (
    <>
      <ProjectsCollection
        onOpen={open}
        collection={displayCollection}
        createAssigneeName={(id) => usePropertyUserDisplay(id).name}
        onCreate={(initialDraft) =>
          layout.popoverSplit({
            type: 'component',
            id: 'project-compose',
            params: initialDraft ? { initialDraft } : undefined,
          })
        }
        scopeId={panel.splitHotkeyScope}
        isActive={panel.isPanelActive}
        canOpenInNewSplit={() =>
          globalSplitManager()?.canAppendSplit() ?? false
        }
        onCopyLink={(id) =>
          void copyLink.executeByBlock(
            projectRouteId({ id, section: 'overview' }),
            'component'
          )
        }
        onCopyId={(id) => void copyId.executeById(id)}
        onShare={(projectId) => setSharing(projectId)}
      />
      <Show when={sharing()} keyed>
        {(projectId) => (
          <ProjectShareLauncher
            projectId={projectId}
            onClose={() => setSharing(undefined)}
          />
        )}
      </Show>
    </>
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
