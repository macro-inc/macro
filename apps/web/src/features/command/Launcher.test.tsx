import { MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  popoverSplit: vi.fn(),
  openWithSplit: vi.fn(),
  createFolder: vi.fn(),
  projectFlag: (): boolean | undefined => true,
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

import {
  CREATABLE_BLOCKS,
  createMenuOpen,
  runCreateAction,
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from './Launcher';

beforeEach(() => {
  host.projectFlag = () => true;
});
afterEach(() => {
  cleanup();
  setCreateMenuOpen(false, false);
  vi.clearAllMocks();
});

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
