import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createTasksWorkspace } from './createTasksWorkspace';
import { TasksWorkspaceMain } from './TasksWorkspace';
import { TasksWorkspaceSidebar } from './TasksWorkspaceSidebar';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function workspace() {
  const c = createTasksWorkspace(createDummyWorkspace('tasks'));
  return c;
}

it('keeps project membership independent of tags and moves an existing task between projects', () => {
  createRoot((dispose) => {
    const c = workspace();
    c.openProject('sales', 'tasks');
    expect(c.tasks()).toHaveLength(5);
    c.assignProject('proposal', 'sales');
    expect(c.tasks().map((task) => task.id)).toContain('proposal');
    c.openProject('customers', 'tasks');
    expect(c.tasks().map((task) => task.id)).not.toContain('proposal');
    c.navigate('all');
    expect(c.w.data.tasks).toHaveLength(12);
    expect(c.metadata.proposal.projectId).toBe('sales');
    dispose();
  });
});

it('creates a task in the current project without changing its generated identity', () => {
  createRoot((dispose) => {
    const c = workspace();
    c.openProject('sales', 'tasks');
    c.setComposer('task');
    c.create({
      ...c.w.data.tasks[0],
      id: 'draft',
      title: 'Confirm Friday’s check-in',
    });
    const task = c
      .tasks()
      .find((item) => item.title === 'Confirm Friday’s check-in')!;
    expect(task.id).not.toBe('draft');
    expect(c.metadata[task.id].projectId).toBe('sales');
    expect(c.tasks()).toHaveLength(6);
    expect(c.composer()).toBeUndefined();
    dispose();
  });
});

it('keeps filtering and grouping scoped to the project, with live status changes', () => {
  createRoot((dispose) => {
    const c = workspace();
    c.openProject('sales', 'tasks');
    c.toggleFilter('status', 'Completed');
    expect(c.tasks().map((task) => task.id)).toEqual(['contacts']);
    c.saveTask('training', { status: 'Completed' });
    expect(c.tasks().map((task) => task.id)).toEqual(['training', 'contacts']);
    c.openProject('customers', 'tasks');
    expect(c.filters.status).toEqual([]);
    expect(c.tasks()).toHaveLength(4);
    dispose();
  });
});

it('opens the real project overview and task collection from the sidebar', () => {
  let disposeState: (() => void) | undefined;
  const c = createRoot((dispose) => {
    disposeState = dispose;
    return workspace();
  });
  const view = render(() => (
    <>
      <TasksWorkspaceSidebar
        state={c}
        collapse={() => {}}
        onNavigate={() => {}}
      />
      <TasksWorkspaceMain state={c} />
    </>
  ));
  fireEvent.click(
    within(view.getByRole('navigation', { name: 'My projects' })).getByRole(
      'button',
      { name: 'Customer proposal' }
    )
  );
  expect(
    view.getByRole('textbox', { name: 'Project description' }).textContent
  ).toContain('Prepare a proposal');
  c.setSection('tasks');
  const table = within(view.getByRole('table', { name: 'Tasks list' }));
  expect(table.getAllByRole('button', { name: /^Open task / })).toHaveLength(5);
  fireEvent.click(
    table.getByRole('button', { name: 'Open task Draft the customer proposal' })
  );
  const description = view.getByRole('textbox', { name: 'Task description' });
  Object.defineProperty(description, 'innerText', {
    value: 'The walkthrough is ready.',
    configurable: true,
  });
  fireEvent.blur(description);
  fireEvent.click(
    view.getAllByRole('button', { name: 'Customer proposal' })[1]
  );
  expect(view.getByRole('table', { name: 'Tasks list' })).toBeTruthy();
  expect(
    c.w.data.tasks.find((task) => task.id === 'training')?.description
  ).toBe('The walkthrough is ready.');
  disposeState?.();
});

it('creates independent project records and restores fixture state on reset', () => {
  createRoot((dispose) => {
    const c = workspace();
    c.setComposer('project');
    c.create({ ...c.projects[0], id: 'draft', title: 'Customer workshop' });
    const project = c.projects.find(
      (item) => item.title === 'Customer workshop'
    )!;
    expect(project.id).not.toBe('draft');
    c.openProject(project.id, 'tasks');
    expect(c.tasks()).toHaveLength(0);
    c.reset();
    expect(c.projects).toHaveLength(3);
    expect(c.w.data.tasks).toHaveLength(12);
    dispose();
  });
});

it('restores separate layouts for the main task list and each project', () => {
  createRoot((dispose) => {
    const c = workspace();
    c.setLayout('Board');
    c.setGroup('Assignee');
    c.openProject('sales', 'tasks');
    expect(c.layout()).toBe('List');
    expect(c.group()).toBe('Status');
    c.setLayout('Board');
    c.openProject('customers', 'tasks');
    expect(c.layout()).toBe('List');
    c.openProject('sales', 'tasks');
    expect(c.layout()).toBe('Board');
    c.navigate('all');
    expect(c.layout()).toBe('Board');
    expect(c.group()).toBe('Assignee');
    dispose();
  });
});

it('expands project search and clears it on Escape without losing the project', () => {
  let disposeState: (() => void) | undefined;
  const c = createRoot((dispose) => {
    disposeState = dispose;
    return workspace();
  });
  c.openProject('sales', 'tasks');
  const view = render(() => <TasksWorkspaceMain state={c} />);
  fireEvent.click(
    view.getByRole('button', { name: 'Search in Customer proposal' })
  );
  const search = view.getByRole('searchbox', {
    name: 'Search in Customer proposal',
  });
  fireEvent.input(search, { target: { value: 'Draft the scope' } });
  expect(c.tasks()).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(c.search()).toBe('');
  expect(c.projectId()).toBe('sales');
  expect(c.tasks()).toHaveLength(5);
  disposeState?.();
});
