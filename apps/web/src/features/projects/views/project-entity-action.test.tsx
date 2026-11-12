import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import {
  type ProjectEntityAction,
  ProjectEntityActionContent,
} from './project-entity-action';

const toast = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(
  action: ProjectEntityAction,
  commands: {
    rename?: (id: string, name: string) => Promise<void>;
    deleteMany?: (ids: readonly string[]) => Promise<string[]>;
  }
) {
  const [shown, setShown] = createSignal(true);
  const unused = (): never => {
    throw new Error('Unused capability');
  };
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unused,
    createPropertyDefinitionsSource: unused,
    createProjectSource: unused,
    createCommands: () => ({
      createTask: vi.fn(),
      pending: () => false,
      create: vi.fn(),
      rename: commands.rename ?? vi.fn(),
      setMembers: vi.fn(),
      assignTasks: vi.fn(),
      delete: vi.fn(),
      deleteMany: commands.deleteMany ?? vi.fn(),
      saveProperty: vi.fn(),
      saveProperties: vi.fn(),
    }),
  };
  render(() => (
    <ProjectsProvider context={context}>
      <Show when={shown()}>
        <ProjectEntityActionContent
          action={action}
          onClose={() => setShown(false)}
        />
      </Show>
    </ProjectsProvider>
  ));
  return { shown };
}

it('renames the project from a list row and closes', async () => {
  const rename = vi.fn(async () => {});
  const view = open({ kind: 'rename', id: 'launch', name: 'Launch' }, {
    rename,
  });

  const input = await screen.findByLabelText('Name');
  fireEvent.input(input, { target: { value: 'Launch v2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

  await vi.waitFor(() => expect(view.shown()).toBe(false));
  expect(rename).toHaveBeenCalledExactlyOnceWith('launch', 'Launch v2');
  expect(toast.success).toHaveBeenCalledOnce();
});

it('keeps only the projects that failed to delete for a retry', async () => {
  const deleteMany = vi
    .fn<(ids: readonly string[]) => Promise<string[]>>()
    .mockResolvedValueOnce(['b'])
    .mockResolvedValueOnce([]);
  const view = open({ kind: 'delete', ids: ['a', 'b'] }, { deleteMany });

  fireEvent.click(
    await screen.findByRole('button', { name: 'Delete 2 projects' })
  );
  expect(
    await screen.findByText(
      'Deleted 1 of 2. The rest could not be deleted.'
    )
  ).toBeTruthy();
  expect(view.shown()).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
  await vi.waitFor(() => expect(view.shown()).toBe(false));
  expect(deleteMany.mock.calls).toEqual([[['a', 'b']], [['b']]]);
  expect(toast.success).toHaveBeenCalledOnce();
});
