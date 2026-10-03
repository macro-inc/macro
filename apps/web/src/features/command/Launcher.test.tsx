import { MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  popoverSplit: vi.fn(),
  openWithSplit: vi.fn(),
  createFolder: vi.fn(),
  projectFlag: (): boolean | undefined => true,
  activeSplitId: undefined as string | undefined,
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ activeSplitId: () => host.activeSplitId }),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => host,
}));
vi.mock('@queries/storage/projects', () => ({
  createProject: host.createFolder,
}));

// Other creation flows are independent of the native project composer.
vi.mock('@app/features/agents-view/primitives/open-composer', () => ({}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({}));
vi.mock('@app/features/block-agent/ui/AgentInput', () => ({}));
vi.mock(
  '@app/features/block-spreadsheet/primitives/use-spreadsheet-access',
  () => ({ useSpreadsheetAccess: () => () => false })
);
vi.mock(
  '@app/features/block-spreadsheet/queries/create-spreadsheet',
  () => ({})
);
vi.mock('@app/features/block-spreadsheet/queries/spreadsheet-access', () => ({
  isSpreadsheetEnabledForCurrentUser: () => false,
}));
vi.mock('@app/features/email-compose/core/constants', () => ({}));
vi.mock('@app/features/reminders/reminder-composer', () => ({}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-projects' ? host.projectFlag() === true : false,
    loading: flag.key === 'enable-projects' && host.projectFlag() === undefined,
  }),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: (flag: { key: string }) =>
    flag.key === 'enable-projects' && host.projectFlag() === true,
}));
vi.mock('@block-automation/component', () => ({}));
vi.mock('@block-md/observability', () => ({}));
vi.mock('@channel/CreateChannelModal', () => ({}));
vi.mock('@core/component/AI/component/input/ChatInput', () => ({}));
vi.mock('@core/component/EntityIcon', () => ({
  getIconConfig: () => ({ icon: () => null, foreground: 'text-ink' }),
}));
vi.mock('@core/directive/focusInput', () => ({}));
vi.mock('@core/hotkey/hotkeys', () => ({}));
vi.mock('@core/hotkey/state', () => ({ pressedKeys: () => new Set() }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/util/create', () => ({}));
vi.mock('@macro-inc/lexical-core/markdown-golden', () => ({}));
vi.mock('@ui', () => ({}));
vi.mock('@ui/components/Hotkey', () => ({}));
vi.mock('./mobile/MobileCreateSheet', () => ({}));

import type { SplitId } from '@components/app/split-layout/layoutManager';
import {
  type DestinationTaskComposer,
  registerCreateDestination,
} from './create-destination';
import {
  CREATABLE_BLOCKS,
  createMenuOpen,
  runCreateAction,
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from './Launcher';

let unregisterDestination: (() => void) | undefined;
beforeEach(() => {
  host.projectFlag = () => true;
  host.activeSplitId = undefined;
});
afterEach(() => {
  cleanup();
  unregisterDestination?.();
  unregisterDestination = undefined;
  setCreateMenuOpen(false, false);
  vi.clearAllMocks();
});

/** A project open in `project-split`, as its detail view registers it. */
function openProject(): DestinationTaskComposer {
  const taskComposer: DestinationTaskComposer = {
    createTask: vi.fn(async () => null),
    leadingChip: () => null,
  };
  unregisterDestination = registerCreateDestination(
    'project-split' as SplitId,
    () => ({ label: 'Launch', taskComposer })
  );
  return taskComposer;
}

function creatable(label: string) {
  const item = CREATABLE_BLOCKS.find((block) => block.label === label);
  if (!item) throw new Error(`Missing ${label} entry`);
  return item;
}

it.each([false, undefined])(
  'blocks Project shortcuts and imperative creation while the flag is %s',
  (enabled) => {
    host.projectFlag = () => enabled;
    const project = CREATABLE_BLOCKS.find(
      (item) => item.blockName === 'initiative'
    );
    expect(project?.enabled?.()).toBe(false);
    project?.keyDownHandler();
    runCreateAction('initiative');
    expect(host.popoverSplit).not.toHaveBeenCalled();
  }
);

it('reactively adds and removes Project while retaining Task and Folder', () => {
  const [enabled, setEnabled] = createSignal<boolean | undefined>(undefined);
  host.projectFlag = enabled;
  const Menu = () => {
    const blocks = useCreateMenuBlocks();
    return (
      <div>
        {blocks()
          .map((item) => item.label)
          .join(', ')}
      </div>
    );
  };
  const view = render(() => (
    <MemoryRouter>
      <Route path="/" component={Menu} />
    </MemoryRouter>
  ));
  expect(view.container.textContent).not.toContain('Project');
  expect(view.container.textContent).toContain('Task');
  expect(view.container.textContent).toContain('Folder');
  setEnabled(true);
  expect(view.container.textContent).toContain('Project');
  setEnabled(false);
  expect(view.container.textContent).not.toContain('Project');
  expect(view.container.textContent).toContain('Folder');
});

it('offers Project in the shared create menu and opens its native composer', () => {
  const project = CREATABLE_BLOCKS.find((item) => item.label === 'Project');
  expect(
    project,
    'Project must be available in every shared Create menu'
  ).toBeDefined();
  if (!project) return;

  setCreateMenuOpen(true);
  host.popoverSplit.mockImplementationOnce(() => {
    // Transfer focus ownership before the launcher closes.
    expect(createMenuOpen()).toBe(true);
  });
  project.keyDownHandler();

  expect(host.popoverSplit).toHaveBeenCalledExactlyOnceWith({
    type: 'component',
    id: 'project-compose',
    params: undefined,
  });
  expect(createMenuOpen()).toBe(false);
  expect(host.openWithSplit).not.toHaveBeenCalled();
  expect(host.createFolder).not.toHaveBeenCalled();
});

it('keeps the existing Folder action separate from Project creation', async () => {
  const folder = CREATABLE_BLOCKS.find((item) => item.label === 'Folder');
  expect(folder).toBeDefined();
  if (!folder) return;
  host.createFolder.mockResolvedValueOnce('folder-id');
  folder.keyDownHandler();

  await vi.waitFor(() => {
    expect(host.openWithSplit).toHaveBeenCalledExactlyOnceWith(
      { type: 'project', id: 'folder-id' },
      { referredFrom: 'launcher', preferNewSplit: false }
    );
  });
  expect(host.createFolder).toHaveBeenCalledExactlyOnceWith({
    name: 'New Folder',
    source: 'create_menu',
    parentId: undefined,
  });
  expect(host.popoverSplit).not.toHaveBeenCalled();
});

it('creates the task in the project open in the active split', () => {
  const taskComposer = openProject();
  host.activeSplitId = 'project-split';

  setCreateMenuOpen(true);
  host.popoverSplit.mockImplementationOnce(() => {
    // Transfer focus ownership before the launcher closes.
    expect(createMenuOpen()).toBe(true);
  });
  creatable('Task').keyDownHandler();

  expect(host.popoverSplit).toHaveBeenCalledExactlyOnceWith({
    type: 'component',
    id: 'task-compose',
    params: taskComposer,
  });
  expect(createMenuOpen()).toBe(false);
});

it('names the open project beside Task, and only there', () => {
  openProject();
  host.activeSplitId = 'project-split';
  expect(creatable('Task').destinationHint?.()).toBe('In Launch');
  expect(
    CREATABLE_BLOCKS.filter((block) => block.destinationHint).map(
      (block) => block.label
    )
  ).toEqual(['Task']);

  host.activeSplitId = 'other-split';
  expect(creatable('Task').destinationHint?.()).toBeUndefined();
});

it('opens the plain task composer when the active split is not a project', () => {
  openProject();
  host.activeSplitId = 'other-split';

  creatable('Task').keyDownHandler();
  runCreateAction('task');

  expect(host.popoverSplit.mock.calls).toEqual([
    [{ type: 'component', id: 'task-compose', params: undefined }],
    [{ type: 'component', id: 'task-compose', params: undefined }],
  ]);
});

it('leaves every other entry unscoped inside a project', async () => {
  openProject();
  host.activeSplitId = 'project-split';

  creatable('Project').keyDownHandler();
  expect(host.popoverSplit).toHaveBeenCalledExactlyOnceWith({
    type: 'component',
    id: 'project-compose',
    params: undefined,
  });

  host.createFolder.mockResolvedValueOnce('folder-id');
  creatable('Folder').keyDownHandler();
  await vi.waitFor(() => expect(host.openWithSplit).toHaveBeenCalledOnce());
  expect(host.createFolder).toHaveBeenCalledExactlyOnceWith({
    name: 'New Folder',
    source: 'create_menu',
    parentId: undefined,
  });
});
