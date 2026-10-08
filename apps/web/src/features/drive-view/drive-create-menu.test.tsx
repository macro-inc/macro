import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DriveCreateMenu } from './drive-create-menu';

const host = vi.hoisted(() => ({
  runCreateAction: vi.fn(),
  selectFolder: vi.fn(),
}));

const [projectId, setProjectId] = createSignal<string | undefined>('child');

vi.mock('@app/components/view-shell', () => {
  const Slot = (props: ParentProps) => <span>{props.children}</span>;
  return {
    ViewSidebar: {
      Action: (props: ParentProps<Record<string, unknown>>) => (
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
    destination: 'Wireframes',
  });
});

it('opens a folder composer inside the current folder', async () => {
  await openMenu();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Folder' }), {
    key: 'Enter',
  });
  expect(host.runCreateAction).toHaveBeenCalledWith('project', {
    projectId: 'child',
    source: 'drive',
    destination: 'Wireframes',
  });
});

it('opens a folder composer at the Drive root outside a folder', async () => {
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
  expect(host.runCreateAction).toHaveBeenCalledWith('project', {
    projectId: undefined,
    source: 'drive',
    destination: 'Drive',
  });
});
