import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ProjectSource,
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';

const mocks = vi.hoisted(() => ({ dataSource: vi.fn() }));
vi.mock('@app/features/tasks-view/tasks-view-context', () => ({
  // Builds the list's data source as the real provider does when it mounts.
  TasksViewProvider: (
    props: ParentProps<{
      sourceFactory: (state: unknown, options: unknown) => unknown;
    }>
  ) => {
    props.sourceFactory({}, {});
    return props.children;
  },
  useTasksView: () => ({ state: { search: '' }, setState: () => {} }),
}));
vi.mock('@app/features/tasks-view/components/TasksControls', () => ({
  TasksControls: () => null,
}));
vi.mock('@app/features/tasks-view/tasks-content', () => ({
  TasksContent: () => null,
}));
vi.mock('@ui', () => ({ Button: () => null }));
vi.mock('../components/project-task-search', () => ({
  ProjectTaskSearch: () => null,
}));
vi.mock('../queries/project-tasks', () => ({
  createProjectTasksDataSource: mocks.dataSource,
}));

import { ProjectTasksList, ProjectTasksProvider } from './project-tasks-list';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pageSource = {
  project: () => undefined,
  properties: () => [],
  loading: () => false,
  error: () => undefined,
  refresh: async () => {},
} satisfies ProjectSource;

function contextWith(
  createProjectSource: ProjectsContext['createProjectSource']
) {
  return { createProjectSource } as unknown as ProjectsContext;
}

it("lists a project page's tasks from the page's own project read", () => {
  const createProjectSource = vi.fn(() => pageSource);
  render(() => (
    <ProjectsProvider context={contextWith(createProjectSource)}>
      <ProjectTasksList
        projectId="launch"
        projectName="Launch"
        source={pageSource}
        onOpenTask={() => true}
      />
    </ProjectsProvider>
  ));
  expect(mocks.dataSource).toHaveBeenCalledWith(
    'launch',
    pageSource,
    expect.anything(),
    expect.anything()
  );
  expect(createProjectSource).not.toHaveBeenCalled();
});

it('reads the project itself where no host holds a read', () => {
  const createProjectSource = vi.fn(() => pageSource);
  render(() => (
    <ProjectsProvider context={contextWith(createProjectSource)}>
      <ProjectTasksProvider projectId="launch" onOpenTask={() => true} />
    </ProjectsProvider>
  ));
  expect(createProjectSource).toHaveBeenCalledOnce();
  expect(mocks.dataSource).toHaveBeenCalledOnce();
});
