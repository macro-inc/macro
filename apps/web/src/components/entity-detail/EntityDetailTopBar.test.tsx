import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ViewBreadcrumbs } from '../view-shell/ViewBreadcrumbs';
import { EntityDetailTopBar } from './EntityDetailTopBar';

vi.mock('@components/app/side-panel', () => ({
  SidePanel: { HeaderActionsOutlet: () => null, Toggle: () => null },
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 1000, height: 48 }),
}));
vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  Tooltip: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));
vi.mock('../view-shell', async () => ({
  ...(await import('../view-shell/ViewBreadcrumbs')),
  ViewShell: {
    TopBar: (props: { children?: JSX.Element }) => (
      <header>{props.children}</header>
    ),
  },
}));

afterEach(cleanup);

it('replaces the active breadcrumb with the title menu and keeps parent navigation', () => {
  const onNavigate = vi.fn();
  const [name, setName] = createSignal('Launch');
  const [editing, setEditing] = createSignal(false);
  render(() => (
    <ViewBreadcrumbs.Root value="project" onChange={onNavigate}>
      <ViewBreadcrumbs.Item value="projects" order={0} metadata={{}}>
        {(item) => (
          <ViewBreadcrumbs.Button onClick={item.onSelect}>
            Projects
          </ViewBreadcrumbs.Button>
        )}
      </ViewBreadcrumbs.Item>
      <ViewBreadcrumbs.Item value="project" order={1} metadata={{}}>
        <ViewBreadcrumbs.Button isActive>{name()}</ViewBreadcrumbs.Button>
      </ViewBreadcrumbs.Item>
      <EntityDetailTopBar
        titleMenu={
          <>
            <span>{name()}</span>
            <button onClick={() => setEditing(true)}>Rename project</button>
          </>
        }
      />
      <Show when={editing()}>
        <button onClick={() => setName('Updated launch')}>Save name</button>
      </Show>
    </ViewBreadcrumbs.Root>
  ));

  const header = within(
    screen.getByRole('navigation', { name: 'Task location' })
  );
  expect(header.getAllByText('Launch')).toHaveLength(1);
  fireEvent.click(header.getByRole('button', { name: 'Rename project' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(header.getAllByText('Updated launch')).toHaveLength(1);
  fireEvent.click(header.getByRole('button', { name: 'Projects' }));
  expect(onNavigate).toHaveBeenCalledWith('projects');
});
