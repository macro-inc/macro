import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createContext, createSignal, Show, useContext } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import {
  SidebarActionOverride,
  SidebarActionRow,
  SidebarActionsProvider,
  useSidebarSearchFocus,
  WorkspaceActions,
} from './SidebarActionRow';
import { SidebarCreateAction } from './SidebarCreateAction';

afterEach(cleanup);

it('keeps subview search in navigation and restores the parent controls on exit', () => {
  const Scope = createContext('parent');
  const [nested, setNested] = createSignal(false);
  const [query, setQuery] = createSignal('');
  function Search() {
    const scope = useContext(Scope);
    return (
      <input
        aria-label={`Search ${scope}`}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
    );
  }
  render(() => (
    <SidebarActionsProvider>
      <aside aria-label="Navigation">
        <SidebarActionRow
          title="Parent"
          search={<input aria-label="Search parent" />}
          create={() => <button>New parent</button>}
        />
      </aside>
      <main>
        <header>
          <WorkspaceActions controls={<button>Filter</button>} />
        </header>
        <Show when={nested()}>
          <Scope.Provider value="projects">
            <SidebarActionOverride
              title="Projects"
              search={<Search />}
              create={() => <button>New project</button>}
            />
          </Scope.Provider>
        </Show>
      </main>
    </SidebarActionsProvider>
  ));
  expect(
    screen.getByLabelText('Search parent').closest('aside')
  ).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Parent' })).toBeTruthy();
  setNested(true);
  expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
  const input = screen.getByLabelText('Search projects');
  expect(input.closest('aside')).not.toBeNull();
  expect(input.closest('[data-sidebar-search]')).not.toBeNull();
  expect(
    screen
      .getAllByText('New project')
      .find((button) => button.closest('aside'))!
      .closest('[data-sidebar-create-area]')
  ).not.toBeNull();
  expect(
    screen.getByText('Filter').closest('[data-workspace-controls]')
  ).not.toBeNull();
  expect(screen.queryByLabelText('Search parent')).toBeNull();
  fireEvent.input(input, { target: { value: 'Plan' } });
  expect(query()).toBe('Plan');
  expect(
    screen
      .getAllByText('New project')
      .find((button) => button.closest('aside'))!
      .closest('aside')
  ).not.toBeNull();
  setNested(false);
  expect(screen.getByLabelText('Search parent')).toBeTruthy();
  expect(screen.queryByText('New project')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Parent' })).toBeTruthy();
});

it('keeps sidebar search mounted across homepage and detail pages', () => {
  const [home, setHome] = createSignal(true);
  const [query, setQuery] = createSignal('');
  render(() => (
    <SidebarActionsProvider>
      <aside>
        <SidebarActionRow
          title="Tasks"
          create={() => <button>Create task</button>}
          search={
            <input
              aria-label="Search tasks"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          }
        />
      </aside>
      <main>
        <Show when={home()} fallback={<header>Task editor</header>}>
          <header>
            <WorkspaceActions controls={<button>Filter</button>} />
          </header>
        </Show>
      </main>
    </SidebarActionsProvider>
  ));
  const input = screen.getByLabelText('Search tasks');
  expect(input.closest('aside')).not.toBeNull();
  expect(input.closest('aside')).not.toBeNull();
  expect(input.closest('[data-sidebar-search]')).not.toBeNull();
  expect(
    screen
      .getAllByText('Create task')
      .find((button) => button.closest('aside'))!
      .closest('[data-sidebar-create-area]')
  ).not.toBeNull();
  expect(
    screen.getByText('Filter').closest('[data-workspace-controls]')
  ).not.toBeNull();
  expect(
    screen
      .getAllByText('Create task')
      .find((button) => button.closest('aside'))!
      .closest('aside')
  ).not.toBeNull();
  fireEvent.input(input, { target: { value: 'Plan' } });
  setHome(false);
  expect(screen.getByLabelText('Search tasks')).toBe(input);
  expect(
    screen
      .getAllByText('Create task')
      .find((button) => button.closest('aside'))!
      .closest('aside')
  ).not.toBeNull();
  setHome(true);
  expect(screen.getByLabelText('Search tasks')).toBe(input);
  expect(query()).toBe('Plan');
});

it('renders independent creation controls that retain their source context and handlers', () => {
  const Scope = createContext('wrong');
  const clicks: string[] = [];
  function Create() {
    const scope = useContext(Scope);
    return <button onClick={() => clicks.push(scope)}>New file</button>;
  }
  render(() => (
    <SidebarActionsProvider>
      <aside>
        <Scope.Provider value="files">
          <SidebarActionRow
            title="Files"
            search={<input aria-label="Search files" />}
            create={() => <Create />}
          />
        </Scope.Provider>
      </aside>
      <header>
        <WorkspaceActions />
      </header>
    </SidebarActionsProvider>
  ));
  const buttons = screen.getAllByRole('button', { name: 'New file' });
  expect(buttons).toHaveLength(2);
  expect(buttons.some((button) => button.closest('aside'))).toBe(true);
  expect(buttons.some((button) => button.closest('header'))).toBe(true);
  for (const button of buttons) fireEvent.click(button);
  expect(clicks).toEqual(['files', 'files']);
});

it('reveals navigation and focuses its existing input for a search shortcut', async () => {
  let reveals = 0;
  function Search() {
    let input: HTMLInputElement | undefined;
    const focus = useSidebarSearchFocus(() => input);
    return (
      <>
        <input ref={input} aria-label="Search files" />
        <button onClick={focus}>Search shortcut</button>
      </>
    );
  }
  render(() => (
    <SidebarActionsProvider revealSearch={() => reveals++}>
      <aside>
        <SidebarActionRow
          title="Files"
          search={<Search />}
          create={() => <button>New file</button>}
        />
      </aside>
      <main>
        <WorkspaceActions />
      </main>
    </SidebarActionsProvider>
  ));
  fireEvent.click(
    screen.getByRole('button', { name: 'Search shortcut', hidden: true })
  );
  await Promise.resolve();
  expect(reveals).toBe(1);
  expect(document.activeElement).toBe(screen.getByLabelText('Search files'));
  expect(screen.getByLabelText('Search files').closest('aside')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Files' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'New file' })).toHaveLength(2);
});

it('expands search from its icon and hides it on Escape without losing the query', async () => {
  const [query, setQuery] = createSignal('');
  render(() => (
    <SidebarActionsProvider>
      <SidebarActionRow
        title="Files"
        search={
          <input
            aria-label="Search files"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        }
      />
    </SidebarActionsProvider>
  ));
  const button = screen.getByRole('button', { name: 'Search Files' });
  const input = screen.getByLabelText('Search files');
  const row = input.closest('[data-sidebar-search]');
  expect(row?.hasAttribute('hidden')).toBe(true);
  fireEvent.click(button);
  await Promise.resolve();
  expect(row?.hasAttribute('hidden')).toBe(false);
  expect(document.activeElement).toBe(input);
  fireEvent.input(input, { target: { value: 'Budget' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(row?.hasAttribute('hidden')).toBe(true);
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  await Promise.resolve();
  expect(query()).toBe('Budget');
  expect(document.activeElement).toBe(input);
});

it('places creation in the title row while preserving the main action', () => {
  const clicked: string[] = [];
  render(() => (
    <SidebarActionsProvider>
      <aside>
        <SidebarActionRow
          title="Tasks"
          search={<input aria-label="Search tasks" />}
          create={() => (
            <SidebarCreateAction
              label="New task"
              onClick={() => clicked.push('task')}
            >
              New
            </SidebarCreateAction>
          )}
          sidebarCreate={() => (
            <>
              <SidebarCreateAction
                label="New task"
                onClick={() => clicked.push('task')}
              >
                New
              </SidebarCreateAction>
              <SidebarCreateAction
                label="New project"
                sidebarLabel="New Project"
                onClick={() => clicked.push('project')}
              >
                New
              </SidebarCreateAction>
            </>
          )}
        />
      </aside>
      <main>
        <WorkspaceActions />
      </main>
    </SidebarActionsProvider>
  ));
  const group = screen.getByRole('group', { name: 'Create in Tasks' });
  expect(group.closest('[data-view-sidebar-header]')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy();
  const taskButtons = screen.getAllByRole('button', { name: 'New task' });
  expect(taskButtons).toHaveLength(2);
  expect(
    taskButtons.find((button) => group.contains(button))?.textContent
  ).toContain('New Task');
  fireEvent.click(screen.getByRole('button', { name: 'New project' }));
  fireEvent.click(taskButtons.find((button) => group.contains(button))!);
  expect(clicked).toEqual(['project', 'task']);
  expect(screen.queryByRole('radio')).toBeNull();
});
