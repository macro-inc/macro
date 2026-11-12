import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_SETTINGS } from './core/project';

const fixture = vi.hoisted(() => ({ touch: false }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true, loading: false }),
  ShowFeatureFlag: (props: ParentProps) => props.children,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixture.touch,
}));
vi.mock('@app/lib/split-router', () => ({
  createSearchParams: () => [
    { savedView: 'view', layout: undefined },
    () => {},
  ],
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => undefined,
      registerEntryStateCaptor: () => () => {},
    },
    splitHotkeyScope: 'fixture',
    isPanelActive: () => true,
  }),
  withSplitPanelOwner: (_key: string, create: () => unknown) => create(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: () => {} }),
}));
vi.mock('@app/features/next-soup/actions', () => ({
  makeCopyLinkAction: () => ({}),
  makeCopyEntityIdAction: () => ({}),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: true, data: undefined }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => undefined,
  getGraphqlSoupCacheHost: () => undefined,
}));
vi.mock('@service-storage/initiative', () => ({ initiativeClient: {} }));
vi.mock('@app/features/tasks-view/tasks-create-action', () => ({
  TasksCreateAction: () => null,
}));
vi.mock('./project-share', () => ({ ProjectShareLauncher: () => null }));
vi.mock('./views/project-assignment', () => ({
  ProjectAssignment: () => null,
}));
vi.mock('./queries/project-sources', () => ({
  createProjectSources: () => ({
    userId: () => 'viewer',
    createCollectionSource: () => ({
      rows: () => [],
      error: () => undefined,
      hasMore: () => false,
      loadingMore: () => false,
      loadMore: async () => {},
      refresh: async () => {},
    }),
  }),
}));
vi.mock('../saved-views/queries/saved-views', () => ({
  useSavedView: () => ({
    data: () => ({
      id: 'view',
      name: 'Timeline',
      ownerId: 'viewer',
      sharedTeamId: null,
      revision: 1,
      config: {
        kind: 'projects',
        version: 1,
        scope: 'all',
        settings: {
          ...DEFAULT_PROJECT_SETTINGS,
          layout: 'gantt',
          status: 'saved-status',
        },
      },
    }),
    viewerId: () => 'viewer',
    error: () => undefined,
    loading: () => false,
    refresh: async () => {},
  }),
  useSavedViews: () => ({
    items: () => [],
    loading: () => false,
    error: () => undefined,
    hasMore: () => false,
    loadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {},
  }),
}));
vi.mock('./views/projects-collection', async () => {
  const { useProjectSavedViews } = await import(
    './context/project-saved-views-context'
  );
  return {
    ProjectsCollection: (props: {
      collection: { layout: () => string; status: () => string };
    }) => {
      const views = useProjectSavedViews();
      return (
        <>
          <output aria-label="Raw layout">{props.collection.layout()}</output>
          <output aria-label="Status filter">
            {props.collection.status()}
          </output>
          <output aria-label="Draft state">
            {JSON.stringify(views?.draft.view())}
          </output>
        </>
      );
    },
  };
});

import { ProjectSavedViewsProvider } from './project-saved-views';
import { ProjectsTab } from './projects';

afterEach(cleanup);
it.each([false, true])(
  'retains a cached Gantt definition without dirtying it on touch=%s',
  (touch) => {
    fixture.touch = touch;
    render(() => (
      <ProjectSavedViewsProvider
        active={() => true}
        enabled={() => true}
        scope={() => 'all'}
        location={() => 'projects'}
        onSelect={() => {}}
      >
        <ProjectsTab onOpen={() => {}} />
      </ProjectSavedViewsProvider>
    ));
    expect(
      JSON.parse(screen.getByLabelText('Draft state').textContent ?? '{}')
    ).toMatchObject({ kind: 'saved', dirty: false });
    expect(screen.getByLabelText('Raw layout').textContent).toBe('gantt');
    expect(screen.getByLabelText('Status filter').textContent).toBe(
      'saved-status'
    );
  }
);
