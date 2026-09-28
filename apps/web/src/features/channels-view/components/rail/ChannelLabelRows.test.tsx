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
import { ChannelLabelMenuItems, ChannelsCreateMenu } from './ChannelLabelRows';

const rail = vi.hoisted(() => ({
  channelTagsEnabled: (): boolean => false,
  labelsAvailable: (): boolean => true,
  labels: () => [
    { id: 'label', name: 'Cached label', channelIds: ['channel'] },
  ],
  createLabel: vi.fn(),
  createSmartTag: vi.fn(),
  setChannelLabel: vi.fn(),
}));
const openNewChannelModal = vi.hoisted(() => vi.fn());

vi.mock('./ChannelsRailContext', () => ({ useChannelsRail: () => rail }));
vi.mock('./hooks/useChannelRailState', () => ({}));
vi.mock('./ChannelRailItems', () => ({}));
vi.mock('@channel/CreateChannelModal', () => ({ openNewChannelModal }));
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
      return <button {...rest} aria-label={local.label} />;
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
  it('shows direct channel creation until labels load and removes label actions if they become unavailable', async () => {
    setEnabled(true);
    setLabelsAvailable(false);
    render(() => <ChannelsCreateMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));
    expect(openNewChannelModal).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Create channel or label' })
    ).toBeNull();
    expect(screen.queryByText('New label')).toBeNull();
    expect(screen.queryByText('New smart label')).toBeNull();

    setLabelsAvailable(true);
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Create channel or label' }),
      { key: 'ArrowDown' }
    );
    const labelAction = await screen.findByRole('menuitem', {
      name: 'New label',
    });
    expect(labelAction.getAttribute('aria-disabled')).not.toBe('true');
    expect(
      screen
        .getByRole('menuitem', { name: 'New smart label' })
        .getAttribute('aria-disabled')
    ).not.toBe('true');

    setLabelsAvailable(false);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));
    expect(openNewChannelModal).toHaveBeenCalledTimes(2);
    expect(rail.createLabel).not.toHaveBeenCalled();
    expect(rail.createSmartTag).not.toHaveBeenCalled();
  });

  it('keeps direct channel creation available and removes an open label menu when disabled', async () => {
    render(() => <ChannelsCreateMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));
    expect(openNewChannelModal).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();

    setEnabled(true);
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Create channel or label' }),
      { key: 'ArrowDown' }
    );
    expect(
      await screen.findByRole('menuitem', { name: 'New label' })
    ).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'New smart label' })
    ).toBeTruthy();

    setEnabled(false);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));
    expect(openNewChannelModal).toHaveBeenCalledTimes(2);
    expect(rail.createLabel).not.toHaveBeenCalled();
    expect(rail.createSmartTag).not.toHaveBeenCalled();
  });

  it('hides cached label actions when the flag changes without remounting', () => {
    const channel = {
      id: 'channel',
      channelType: 'team',
    } as ChannelEntity;
    render(() => <ChannelLabelMenuItems channel={channel} />);

    expect(screen.queryByText('Move to label')).toBeNull();
    expect(screen.queryByText('Cached label')).toBeNull();

    setEnabled(true);
    expect(screen.getByText('Move to label')).toBeTruthy();
    expect(screen.getByText('Cached label')).toBeTruthy();
    expect(screen.getByText('Ungroup from “Cached label”')).toBeTruthy();

    setEnabled(false);
    expect(screen.queryByText('Move to label')).toBeNull();
    expect(screen.queryByText('Cached label')).toBeNull();
    expect(screen.queryByText('Ungroup from “Cached label”')).toBeNull();
    expect(rail.setChannelLabel).not.toHaveBeenCalled();
  });

  it.each(['public', 'private', 'direct_message'] as const)(
    'hides all label actions for %s channels even with cached membership and the flag enabled',
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
      expect(screen.queryByText('Move to label')).toBeNull();
      expect(screen.queryByText('Add to label')).toBeNull();
      expect(screen.queryByText('New label…')).toBeNull();
      expect(screen.queryByText('Ungroup from “Cached label”')).toBeNull();
      expect(rail.setChannelLabel).not.toHaveBeenCalled();
    }
  );
});
