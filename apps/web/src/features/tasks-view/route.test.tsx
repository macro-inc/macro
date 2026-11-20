import {
  claimOf,
  createMemoryHistory,
  createMemoryPaneStore,
  createRoutesManifest,
  createSearchParamsCodec,
  createSplitRouter,
  decodePane,
  formatPanePath,
  routeParams,
} from '@app/lib/split-router';
import {
  projectDetailRoute,
  projectTaskRoute,
  taskDetailRoute,
  tasksProjectsRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { projectDetailSearch } from './project-detail-search';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const projectId = '01a0cf92-3101-7e21-9a20-6e21058d20e0';
const manifest = createRoutesManifest({
  definitions: [
    {
      ...tasksSplitRoute,
      children: [
        { ...projectDetailRoute, children: [projectTaskRoute] },
        tasksProjectsRoute,
        taskDetailRoute,
      ],
    },
  ],
  defaultRoute: () => ({ matches: [{ id: tasksSplitRoute.id, params: {} }] }),
});

describe('project routes in Tasks', () => {
  it.each(['overview', 'tasks'])(
    'restores the %s section in the Tasks shell and claims the same project',
    (section) => {
      const segments = ['tasks', 'projects', projectId, section];
      const route = decodePane(manifest, segments)!;
      expect(formatPanePath(manifest, route)).toBe(`/${segments.join('/')}`);
      expect(route.matches.map((match) => match.id)).toEqual([
        'view-tasks',
        'tasks-project',
      ]);
      expect(routeParams(route)).toEqual({ projectId, section });
      // The same claim as the initiative block, so either view is reused.
      expect(claimOf(manifest, route)).toBe(`block:initiative:${projectId}`);
      const leaf = route.matches.at(-1)!;
      expect(
        manifest.byId
          .get(leaf.id)
          ?.definition.toReference?.(leaf.params, new URLSearchParams())
      ).toEqual({ type: 'initiative', id: projectId });
    }
  );

  it('pushes project sections and restores Overview with pane or browser back', async () => {
    const overviewPath = `/tasks/projects/${projectId}/overview`;
    const tasksPath = `/tasks/projects/${projectId}/tasks`;
    const history = createMemoryHistory(overviewPath);
    const { router, dispose } = createRoot((dispose) => ({
      router: createSplitRouter({
        routes: {
          definitions: [{ ...tasksSplitRoute, children: [projectDetailRoute] }],
          defaultRoute: () => ({
            matches: [{ id: tasksSplitRoute.id, params: {} }],
          }),
        },
        history,
        paneStore: createMemoryPaneStore(),
        policy: {
          placeNewPane: () => ({ insertAt: 0 }),
          closeAction: () => ({ type: 'keep' }),
          activate: () => {},
        },
      }),
      dispose,
    }));
    try {
      await router.ready;
      const pane = router.panes()[0]!;
      const openTasks = () =>
        router.navigatePane(pane, {
          route: projectDetailRoute,
          params: { projectId, section: 'tasks' },
        });
      await openTasks();
      expect(history.entries().map((entry) => entry.path)).toEqual([
        overviewPath,
        tasksPath,
      ]);
      expect(router.history(pane)?.index).toBe(1);

      await router.navigatePane(pane, -1);
      expect(history.read().path).toBe(overviewPath);
      expect(router.history(pane)?.index).toBe(0);

      await openTasks();
      history.back();
      await router.settled();
      expect(history.read().path).toBe(overviewPath);
      expect(router.history(pane)?.index).toBe(0);
      history.forward();
      await router.settled();
      expect(history.read().path).toBe(tasksPath);
      expect(router.history(pane)?.index).toBe(1);
    } finally {
      router.dispose();
      dispose();
    }
  });

  it('retains project ancestry when opening a task and claims the task document', () => {
    const segments = [
      'tasks',
      'projects',
      projectId,
      'tasks',
      'task',
      'task-1',
    ];
    const route = decodePane(manifest, segments)!;
    expect(formatPanePath(manifest, route)).toBe(`/${segments.join('/')}`);
    expect(route.matches.map((match) => match.id)).toEqual([
      'view-tasks',
      'tasks-project',
      'tasks-project-task',
    ]);
    expect(routeParams(route)).toEqual({
      projectId,
      section: 'tasks',
      taskId: 'task-1',
    });
    expect(claimOf(manifest, route)).toBe('block:md:task-1');
  });

  it('resolves Projects as a collection instead of a task named projects', () => {
    const route = decodePane(manifest, ['tasks', 'projects'])!;
    expect(route.matches.at(-1)?.id).toBe('tasks-projects');
    expect(routeParams(route)).toEqual({ projectsTab: 'projects' });
  });

  it('restores a discussion target from the project search namespace', () => {
    const codec = createSearchParamsCodec(projectDetailSearch);
    const discussionId = '01a0cf92-3101-7e21-9a20-6e21058d20e1';
    expect(codec.parse(codec.serialize({ discussionId }))).toEqual({
      valid: true,
      value: { discussionId },
    });
  });
});
