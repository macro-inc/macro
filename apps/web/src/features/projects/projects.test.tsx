import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import {
  createMemo,
  createRoot,
  createSignal,
  type ParentProps,
  Show,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: (): boolean => false,
  page: vi.fn(),
  get: vi.fn(),
  tasks: vi.fn(),
  taskReferences: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => createMemo(() => ({ enabled: mocks.enabled() })),
  ShowFeatureFlag: (props: ParentProps) => (
    <Show when={mocks.enabled()}>{props.children}</Show>
  ),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
// The list and assignment hosts are outside this provider/query lifecycle test.
vi.mock('@app/components/list/owned-slots', () => ({}));
vi.mock('@components/app/split-layout/layout', () => ({}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({}));
vi.mock('@ui', () => ({
  Button: (props: ParentProps) => <button>{props.children}</button>,
}));
vi.mock('./primitives/project-collection', () => ({}));
vi.mock('./project-collection-persistence', () => ({}));
vi.mock('./views/project-assignment', () => ({}));
vi.mock('./views/projects-collection', () => ({}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: () => () => {},
}));
vi.mock('@service-storage/initiative', () => ({
  initiativeClient: mocks,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
// These independent property/hydration adapters are not used by this fixture.
vi.mock('@entity', () => ({ isTaskEntity: () => false }));
vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: vi.fn(),
}));
vi.mock('@queries/properties/definitions', () => ({}));
vi.mock('@queries/properties/graphql/entity', () => ({}));
vi.mock('@queries/soup/transform-utils', () => ({}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => undefined,
}));
vi.mock('./queries/project-channel-names', () => ({
  createProjectChannelNamesSource: () => () => new Map(),
}));

import { queryClient } from '@queries/client';
import {
  type ProjectsContext,
  useProjectsContext,
} from './context/projects-context';
import { Projects } from './projects';
import { createProjectSources } from './queries/project-sources';

const project = {
  id: 'launch',
  name: 'Launch',
  descriptionDocumentId: 'description',
  ownerId: 'viewer',
  memberIds: [],
  taskIds: ['task'],
  userAccessLevel: 'owner',
  updatedAt: '2026-09-22T12:00:00Z',
  createdAt: '2026-09-22T12:00:00Z',
  properties: [],
  taskCount: 1,
  completedTaskCount: 0,
  sharePermission: {},
};

let disposeSource: (() => void) | undefined;
afterEach(() => {
  disposeSource?.();
  disposeSource = undefined;
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('keeps retained query sources gated after their view owner is disposed', async () => {
  vi.useFakeTimers();
  const [enabled, setEnabled] = createSignal(true);
  mocks.enabled = enabled;
  mocks.page.mockResolvedValue(
    ok({ initiatives: [project], nextCursor: 'next' })
  );
  mocks.get.mockResolvedValue(ok(project));
  mocks.tasks.mockResolvedValue(ok({ taskIds: [], nextCursor: 'next' }));
  mocks.taskReferences.mockResolvedValue(
    ok({
      references: [{ taskId: 'task', state: 'visible', initiative: project }],
    })
  );

  // The context belongs to a view, but split-owned queries are constructed
  // under a separate owner that survives view unmount.
  let context: ProjectsContext | undefined;
  function CaptureContext() {
    context = useProjectsContext();
    return null;
  }
  const view = render(() => (
    <Projects>
      <CaptureContext />
    </Projects>
  ));
  if (!context) throw new Error('Projects provider did not mount');
  const retainedContext = context;
  view.unmount();
  setEnabled(false);
  const sources = createRoot((dispose) => {
    disposeSource = dispose;
    return {
      collection: retainedContext.createCollectionSource(),
      detail: retainedContext.createProjectSource(() => 'launch'),
      tasks: retainedContext.createTasksSource(() => 'launch'),
      references: retainedContext.createReferencesSource(() => ['task']),
    };
  });
  await vi.advanceTimersByTimeAsync(60_000);
  for (const request of [
    mocks.page,
    mocks.get,
    mocks.tasks,
    mocks.taskReferences,
  ])
    expect(request).not.toHaveBeenCalled();

  setEnabled(true);
  await vi.waitFor(() => expect(sources.detail.project()?.name).toBe('Launch'));
  expect(sources.collection.rows()).toHaveLength(1);
  expect(sources.references.references().size).toBe(1);
  expect(sources.tasks.hasMore()).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  for (const request of [
    mocks.page,
    mocks.get,
    mocks.tasks,
    mocks.taskReferences,
  ])
    expect(request).toHaveBeenCalledTimes(2);

  setEnabled(false);
  expect(sources.collection.rows()).toBeUndefined();
  expect(sources.detail.project()).toBeUndefined();
  expect(sources.tasks.hasMore()).toBe(false);
  expect(sources.references.references().size).toBe(0);
  await Promise.all([
    sources.collection.loadMore(),
    sources.collection.refresh(),
    sources.detail.refresh(),
    sources.tasks.loadMore(),
    queryClient.invalidateQueries(),
  ]);
  await vi.advanceTimersByTimeAsync(60_000);
  for (const request of [
    mocks.page,
    mocks.get,
    mocks.tasks,
    mocks.taskReferences,
  ])
    expect(request).toHaveBeenCalledTimes(2);

  setEnabled(true);
  await vi.waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(3));
  expect(sources.detail.project()?.name).toBe('Launch');
});

it('keeps standalone source adapters enabled when no rollout gate is injected', async () => {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { initiativeClient } = await import('@service-storage/initiative');
  mocks.get.mockResolvedValue(ok(project));
  const source = createRoot((dispose) => {
    disposeSource = dispose;
    return createProjectSources(
      initiativeClient,
      cache,
      () => 'viewer',
      () => {}
    ).createProjectSource(() => 'launch');
  });
  await vi.waitFor(() => expect(source.project()?.name).toBe('Launch'));
  cache.clear();
});
