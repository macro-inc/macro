import type { BlockTool } from '@components/app/block-tool';
import { Permissions } from '@core/component/SharePermissions';
import type { EntityData } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Accessor } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitPanelContext, type SplitPanelContextType } from '../context';
import { SplitFileMenu } from './SplitFileMenu';

const mocks = vi.hoisted(() => ({
  touch: true,
  rename: vi.fn(),
  setPicture: vi.fn(),
  removePicture: vi.fn(),
  unavailableAction: () => ({ canExecute: () => false, execute: () => {} }),
  canMute: false,
  settingsMenu: vi.fn<() => object | undefined>(() => undefined),
  titleActions: vi.fn(),
}));

vi.mock('@app/features/next-soup/actions', () => ({
  makeAddTagAction: mocks.unavailableAction,
  makeCopyEntityIdAction: mocks.unavailableAction,
  makeCopyLinkAction: mocks.unavailableAction,
  makeCreateReminderAction: mocks.unavailableAction,
  makeFavoriteAction: mocks.unavailableAction,
  makeMuteAction: () => ({
    canExecute: () => mocks.canMute,
    isMuted: () => false,
    menu: () => ({ label: 'mute', unmuteLabel: 'unmute' }),
    execute: () => {},
  }),
  notificationSettingsMenuFor: mocks.settingsMenu,
}));
vi.mock(
  '@notifications/primitives/create-channel-notification-settings',
  () => ({ useChannelNotificationSettings: () => ({ enabled: () => false }) })
);
vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: vi.fn(),
}));
vi.mock('@app/features/entity/bulk-edit/moved-to-folder-toast', () => ({
  toastMovedToFolder: vi.fn(),
}));
vi.mock('@app/features/entity-appearance/appearance-menu', () => ({
  EntityAppearanceMenu: () => null,
}));
vi.mock('@app/features/entity-appearance/entity-appearance', () => ({
  useChangeEntityIcon: () => vi.fn(),
}));
vi.mock('@app/features/projects/projects', () => ({
  ProjectAssignmentDialog: () => null,
}));
vi.mock('@app/features/property/tags/EntityTagSubmenu', () => ({
  EntityTagSubmenu: () => null,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@core/component/FileList/useItemOperations', () => ({
  useItemOperations: () => ({ copyItem: vi.fn() }),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ getById: () => undefined }),
}));
vi.mock('@core/hotkey/utils', () => ({
  getActiveCommandByToken: () => undefined,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('../layout', () => ({
  useSplitLayout: () => ({ replaceOrInsertSplit: vi.fn() }),
}));
vi.mock('../layoutUtils', () => ({
  returnSplitToRecentListView: vi.fn(),
}));

const Icon = () => <svg />;

// A channel's title menu tools: three in the same section, passed the way
// headers pass them, as a JSX array literal that is rebuilt on every read.
const channelTools = (): BlockTool[] => [
  {
    group: 'file',
    label: () => 'Rename',
    icon: Icon,
    action: mocks.rename,
  },
  {
    group: 'file',
    label: () => 'Set channel picture',
    icon: Icon,
    action: mocks.setPicture,
  },
  {
    group: 'file',
    label: () => 'Remove channel picture',
    icon: Icon,
    action: mocks.removePicture,
  },
];

const renderMenu = (entity?: EntityData) => {
  let openMenu: Accessor<(() => void) | undefined> = () => undefined;
  const panel = {
    setTitleFileMenuTrigger: (value: Accessor<() => void> | undefined) => {
      openMenu = value ?? (() => undefined);
    },
    setTitleFileMenuActions: mocks.titleActions,
  } as unknown as SplitPanelContextType;
  render(() => (
    <SplitPanelContext.Provider value={panel}>
      <SplitFileMenu
        id="channel"
        itemType="channel"
        name="General"
        ops={[]}
        tools={channelTools()}
        entityKind="channel"
        entity={entity}
        permissions={Permissions.OWNER}
      />
    </SplitPanelContext.Provider>
  ));
  return { open: () => openMenu()?.() };
};

const rowLabels = () =>
  screen
    .getAllByRole('button')
    .map((row) => row.textContent?.trim())
    .filter(Boolean);

// The copy rows every split menu adds, then the channel tools.
const MENU_ROWS = [
  'entityActions.copyLink',
  'entityActions.copyId',
  'Rename',
  'Set channel picture',
  'Remove channel picture',
];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.touch = true;
  mocks.canMute = false;
  mocks.settingsMenu.mockReset();
});

describe('SplitFileMenu tools', () => {
  it('lists each tool once in the touch drawer', async () => {
    const menu = renderMenu();
    menu.open();

    await screen.findByRole('dialog');
    expect(rowLabels()).toEqual(MENU_ROWS);
  });

  it('runs the tool whose row was tapped', async () => {
    const menu = renderMenu();
    menu.open();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set channel picture' })
    );

    expect(mocks.setPicture).toHaveBeenCalledOnce();
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it('lists each tool once in the desktop menu', async () => {
    mocks.touch = false;
    const menu = renderMenu();
    menu.open();

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent?.trim())).toEqual(MENU_ROWS);
  });
});

describe('SplitFileMenu notification actions', () => {
  const channel = {
    type: 'channel',
    id: 'channel',
    name: 'General',
  } as unknown as EntityData;
  const sectionIds = () => {
    const groups = mocks.titleActions.mock.lastCall?.[0] as
      | Record<string, { id?: string }[]>
      | undefined;
    return {
      macro: groups?.macro.map(({ id }) => id),
      notifications: groups?.notifications.map(({ id }) => id),
    };
  };

  it('puts Mute and Notification Settings in a section of their own', () => {
    mocks.canMute = true;
    mocks.settingsMenu.mockReturnValue({});
    renderMenu(channel);

    expect(sectionIds()).toEqual({
      macro: [],
      notifications: ['mute', 'notification-settings'],
    });
  });

  it('keeps Mute with the platform actions without Notification Settings', () => {
    mocks.canMute = true;
    renderMenu(channel);

    expect(sectionIds()).toEqual({ macro: ['mute'], notifications: [] });
  });
});
