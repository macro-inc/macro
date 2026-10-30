import type { ChannelEntity } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  type ComponentProps,
  createSignal,
  type ParentProps,
  type Setter,
  splitProps,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelLabelMenuItems,
  ChannelsSectionsMenu,
} from './ChannelLabelRows';

const rail = vi.hoisted(() => ({
  channelTagsEnabled: (): boolean => false,
  labelsAvailable: (): boolean => true,
  canShareSections: () => true,
  labels: () => [
    { id: 'label', name: 'Cached label', channelIds: ['channel'] },
  ],
  createLabel: vi.fn(),
  setChannelLabel: vi.fn(),
  isLabelOpen: () => true,
  labelUnreadCount: () => 0,
  sectionPreferences: () => ({ sort: 'name' }),
  setSectionPreferences: vi.fn(),
  isGroupOpen: () => true,
  toggleGroup: vi.fn(),
  toggleLabel: vi.fn(),
  renameLabel: vi.fn(),
  deleteLabel: vi.fn(),
  markLabelRead: vi.fn(),
}));

vi.mock('./ChannelsRailContext', () => ({ useChannelsRail: () => rail }));
vi.mock('./hooks/useChannelRailState', () => ({}));
vi.mock('./ChannelRailItems', () => ({}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@app/components/view-shell', () => ({
  ViewSidebar: {
    Control: (
      props: ComponentProps<'button'> & {
        label: string;
        variant?: string;
        size?: string;
      }
    ) => {
      const [local, rest] = splitProps(props, ['label', 'variant', 'size']);
      return (
        <button {...rest} aria-label={local.label ?? rest['aria-label']} />
      );
    },
  },
}));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Dropdown')),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));
vi.mock('@core/component/ContextMenu', () => ({
  ContextMenuContent: (props: ParentProps) => <div>{props.children}</div>,
  MenuItem: (props: { text: string; onClick?: () => void }) => (
    <button onClick={props.onClick}>{props.text}</button>
  ),
  MenuSeparator: () => <hr />,
  SubTrigger: (props: { text: string }) => <span>{props.text}</span>,
}));
vi.mock('@kobalte/core/context-menu', () => ({
  ContextMenu: {
    Sub: (props: ParentProps) => props.children,
    RadioGroup: (props: ParentProps) => props.children,
  },
}));

let setEnabled: Setter<boolean>;
let setLabelsAvailable: Setter<boolean>;
beforeEach(() => {
  [rail.channelTagsEnabled, setEnabled] = createSignal(false);
  [rail.labelsAvailable, setLabelsAvailable] = createSignal(true);
  vi.clearAllMocks();
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('channel tag flag in rail menus', () => {
  it('offers management only after labels load', async () => {
    setEnabled(true);
    setLabelsAvailable(false);
    render(() => <ChannelsSectionsMenu />);
    expect(
      screen.queryByRole('button', { name: 'Manage sections' })
    ).toBeNull();

    setLabelsAvailable(true);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Manage sections' }), {
      key: 'ArrowDown',
    });
    expect(
      await screen.findByRole('menuitem', { name: /Cached label/ })
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'Personal section' })
    ).toBeNull();

    setLabelsAvailable(false);
    expect(
      screen.queryByRole('button', { name: 'Manage sections' })
    ).toBeNull();
  });

  it('removes an open section menu when the flag turns off', async () => {
    setEnabled(true);
    render(() => <ChannelsSectionsMenu />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Manage sections' }), {
      key: 'ArrowDown',
    });
    expect(
      await screen.findByRole('menuitem', { name: /Cached label/ })
    ).toBeTruthy();
    setEnabled(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Manage sections' })
    ).toBeNull();
    expect(rail.createLabel).not.toHaveBeenCalled();
  });

  it('hides cached label actions when the flag changes without remounting', () => {
    const channel = {
      id: 'channel',
      channelType: 'team',
    } as ChannelEntity;
    render(() => <ChannelLabelMenuItems channel={channel} />);

    expect(screen.queryByText('Add to section')).toBeNull();
    expect(screen.queryByText('Cached label')).toBeNull();

    setEnabled(true);
    expect(screen.getByText('Add to section')).toBeTruthy();
    expect(screen.getByText('Cached label')).toBeTruthy();
    expect(screen.getByText('Remove from “Cached label”')).toBeTruthy();

    setEnabled(false);
    expect(screen.queryByText('Add to section')).toBeNull();
    expect(screen.queryByText('Cached label')).toBeNull();
    expect(screen.queryByText('Remove from “Cached label”')).toBeNull();
    expect(rail.setChannelLabel).not.toHaveBeenCalled();
  });

  it.each(['public', 'private'] as const)(
    'offers personal sections for %s channels without offering shared sections',
    (channelType) => {
      setEnabled(true);
      render(() => (
        <ChannelLabelMenuItems
          channel={{
            id: 'channel',
            name: 'Channel',
            ownerId: 'user',
            type: 'channel',
            channelType,
          }}
        />
      ));
      expect(screen.getByText('Personal')).toBeTruthy();
      expect(screen.queryByText('Shared with team')).toBeNull();
      fireEvent.click(screen.getByText('Remove from “Cached label”'));
      expect(rail.setChannelLabel).toHaveBeenCalledWith(
        'channel',
        undefined,
        'label'
      );
    }
  );

  it.each(['direct_message'] as const)(
    'hides all section actions for %s conversations',
    (channelType) => {
      setEnabled(true);
      const channel: ChannelEntity = {
        id: 'channel',
        name: 'Channel',
        ownerId: 'alice',
        type: 'channel',
        channelType,
      };
      const view = render(() => <ChannelLabelMenuItems channel={channel} />);

      expect(view.container.textContent).toBe('');
      expect(screen.queryByText('Add to section')).toBeNull();
      expect(screen.queryByText('New section')).toBeNull();
      expect(screen.queryByText('Remove from “Cached label”')).toBeNull();
      expect(rail.setChannelLabel).not.toHaveBeenCalled();
    }
  );
});
