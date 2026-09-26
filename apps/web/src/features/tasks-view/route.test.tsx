import {
  createRoutesManifest,
  decodeRoute,
  encodeRoute,
  getRouteClaim,
  routeParams,
} from '@app/lib/split-router/routes';
import { createSearchParamsCodec } from '@app/lib/split-router/search-params-codec';
import { describe, expect, it, vi } from 'vitest';
import { projectDetailSearch, tasksSplitRoute } from './route';

vi.mock('@app/features/projects/project-detail', () => ({
  ProjectBreadcrumb: () => null,
  ProjectDetail: () => null,
}));
vi.mock('@app/features/projects/projects', () => ({ Projects: () => null }));
vi.mock('@app/features/projects/views/project-tasks-list', () => ({
  ProjectTasksProvider: () => null,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@components/app/side-panel', () => ({ SidePanel: {} }));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (value: unknown) => value,
  NewAppView: () => null,
  RedirectSplit: () => null,
}));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('@core/context/user', () => ({ useUserContext: () => ({}) }));
vi.mock('../next-soup/sidebar/soup-filter-presets', () => ({
  getViewPreset: () => undefined,
}));
vi.mock('./components/TasksDetailView', () => ({
  TasksDetailView: () => null,
  TasksDetailRouteView: () => null,
}));
vi.mock('./tasks-view', () => ({ TasksView: () => null }));

const projectId = '01a0cf92-3101-7e21-9a20-6e21058d20e0';
const manifest = createRoutesManifest({ definitions: [tasksSplitRoute] });

describe('project routes in Tasks', () => {
  it.each(['overview', 'tasks'])(
    'restores the %s section in the Tasks shell and claims the same project',
    (section) => {
      const segments = ['tasks', 'projects', projectId, section];
      const entry = decodeRoute(manifest, segments)!;
      expect(encodeRoute(manifest, entry)).toEqual(segments);
      expect(entry.location.route.matches.map((match) => match.id)).toEqual([
        'view-tasks',
        'tasks-project',
      ]);
      expect(routeParams(entry.location.route)).toEqual({ projectId, section });
      expect(getRouteClaim(manifest, entry.location.route)).toEqual({
        namespace: 'initiative',
        id: projectId,
      });
    }
  );

  it('retains project ancestry when opening a task and claims the task document', () => {
    const segments = [
      'tasks',
      'projects',
      projectId,
      'tasks',
      'task',
      'task-1',
    ];
    const entry = decodeRoute(manifest, segments)!;
    expect(encodeRoute(manifest, entry)).toEqual(segments);
    expect(entry.location.route.matches.map((match) => match.id)).toEqual([
      'view-tasks',
      'tasks-project',
      'tasks-project-task',
    ]);
    expect(routeParams(entry.location.route)).toEqual({
      projectId,
      section: 'tasks',
      taskId: 'task-1',
    });
    expect(getRouteClaim(manifest, entry.location.route)).toEqual({
      namespace: 'block',
      id: 'md:task-1',
    });
  });

  it('resolves Projects as a collection instead of a task named projects', () => {
    const entry = decodeRoute(manifest, ['tasks', 'projects'])!;
    expect(entry.location.route.matches.at(-1)?.id).toBe('tasks-projects');
    expect(routeParams(entry.location.route)).toEqual({
      projectsTab: 'projects',
    });
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
