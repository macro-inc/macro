import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DriveCreateMenu } from './drive-create-menu';

const host = vi.hoisted(() => ({
  runCreateAction: vi.fn(),
  createProject: vi.fn(),
  toastSuccess: vi.fn(),
  selectFolder: vi.fn(),
}));

const [projectId, setProjectId] = createSignal<string | undefined>('child');

vi.mock('@app/components/view-shell', () => {
  const Slot = (props: ParentProps) => <span>{props.children}</span>;
  return {
    ViewSidebar: {
      BigAction: (props: ParentProps<Record<string, unknown>>) => (
        <button type="button" {...props} />
      ),
      Icon: Slot,
      Trailing: Slot,
    },
  };
});
vi.mock('@app/features/command/Launcher', () => ({
  CREATABLE_BLOCKS: [
    { label: 'Document', blockName: 'md', icon: () => null },
    { label: 'Folder', blockName: 'project', icon: () => null },
    { label: 'Database', blockName: 'database', icon: () => null },
  ],
  runCreateAction: host.runCreateAction,
  useCreatableEnabled: () => () => true,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: host.toastSuccess },
}));
vi.mock('@queries/storage/projects', () => ({
  createProject: host.createProject,
}));
vi.mock('./context/drive-context', () => ({
  useDriveView: () => ({
    state: { projectId, selectFolder: host.selectFolder },
    sidebar: {
      folders: () => [
        { id: 'root', name: 'Design', userId: 'user' },
        { id: 'child', name: 'Wireframes', parentId: 'root', userId: 'user' },
      ],
    },
    actions: { uploadFiles: vi.fn(), uploadFolder: vi.fn() },
  }),
}));

beforeEach(() => {
  setProjectId('child');
  host.createProject.mockResolvedValue('new-folder');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openMenu() {
  render(() => <DriveCreateMenu />);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'New file or folder in Wireframes' }),
    { key: 'Enter' }
  );
  return screen.findByRole('menu');
}

it('names the open folder as the destination', async () => {
  const menu = await openMenu();

  expect(menu.textContent).toContain('Create in');
  expect(menu.textContent).toContain('Wireframes');
});

it('creates files inside the open folder', async () => {
  await openMenu();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Document' }), {
    key: 'Enter',
  });

  expect(host.runCreateAction).toHaveBeenCalledWith('md', {
    projectId: 'child',
    source: 'drive',
  });
});

it('names a new folder and creates it inside the open folder', async () => {
  await openMenu();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Folder' }), {
    key: 'Enter',
  });

  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('Wireframes');

  fireEvent.input(screen.getByLabelText('Name'), {
    target: { value: '  Sketches ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(host.createProject).toHaveBeenCalledWith({
      name: 'Sketches',
      parentId: 'child',
      source: 'drive',
    })
  );
  expect(host.runCreateAction).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(host.toastSuccess).toHaveBeenCalledWith(
    'Created “Sketches”',
    expect.objectContaining({ subtext: 'In Wireframes' })
  );
});

it('keeps the dialog open when the folder is not created', async () => {
  host.createProject.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await openMenu();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Folder' }), {
    key: 'Enter',
  });
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('creates at the Drive root outside a folder', async () => {
  setProjectId(undefined);
  render(() => <DriveCreateMenu />);

  fireEvent.keyDown(
    screen.getByRole('button', { name: 'New file or folder in Drive' }),
    { key: 'Enter' }
  );
  await screen.findByRole('menu');
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Folder' }), {
    key: 'Enter',
  });
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(host.createProject).toHaveBeenCalledWith({
      name: 'Untitled folder',
      parentId: undefined,
      source: 'drive',
    })
  );
});
