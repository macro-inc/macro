import type { ChannelEntity } from '@entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  type ComponentProps,
  createSignal,
  type JSX,
  type ParentProps,
  type Setter,
  splitProps,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelFavoriteRow } from './ChannelFavoriteRows';

const rail = vi.hoisted(() => ({
  channelById: (_channelId: string): ChannelEntity | undefined => undefined,
  activateRow: vi.fn(),
  list: { focus: { set: vi.fn() } },
}));

vi.mock('./ChannelsRailContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ChannelsRailContext')>()),
  useChannelsRail: () => rail,
}));
vi.mock('./ChannelsRailSection', () => ({}));
vi.mock('./hooks/useChannelRailState', () => ({
  useChannelRailFavoriteItemState: () => () => ({
    domId: 'rail-favorite-row',
    selected: false,
    focused: false,
  }),
  useChannelRailFavoritesState: () => () => ({
    items: [],
    open: true,
    focused: false,
    containsFocus: false,
    domId: 'rail-favorites-section',
  }),
}));
vi.mock('./ChannelRailItems', () => ({
  isPrimaryMouseDown: (event: MouseEvent) => event.button === 0,
  ChannelRailItemContextMenu: (
    props: ParentProps<{
      channel: ChannelEntity;
      rowId?: string;
      extraItems?: JSX.Element;
    }>
  ) => (
    <div
      data-testid="channel-actions"
      data-channel={props.channel.id}
      data-row-id={props.rowId}
    >
      {props.children}
      {props.extraItems}
    </div>
  ),
}));
vi.mock('./ChannelLabelRows', () => ({
  ChannelLabelMenuItems: (props: { channel: ChannelEntity }) => (
    <span data-testid="label-actions" data-channel={props.channel.id} />
  ),
}));
vi.mock('@app/features/favorites/FavoriteContextMenu', () => ({
  FavoriteContextMenu: (
    props: ParentProps<{
      favorite: Favorite;
      onOpenChange?: (open: boolean) => void;
    }>
  ) => (
    <div data-testid="favorite-actions" data-entity={props.favorite.entityId}>
      <button type="button" onClick={() => props.onOpenChange?.(true)}>
        Open favorite menu
      </button>
      {props.children}
    </div>
  ),
}));
vi.mock('@app/features/favorites/FavoriteIcon', () => ({
  FavoriteIcon: () => <span />,
}));
vi.mock('@app/util/favorites', () => ({
  useFavoriteDisplayName: () => () => 'Design',
}));
vi.mock('@app/components/view-shell', () => ({
  ViewSidebar: {
    Item: (
      props: ComponentProps<'div'> & { as?: string; active?: boolean }
    ) => {
      const [, rest] = splitProps(props, ['as', 'active']);
      return <div {...rest} />;
    },
    Icon: (props: ParentProps) => <span>{props.children}</span>,
  },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

const favorite: Favorite = {
  entityType: 'channel',
  entityId: 'design',
  sortOrder: 0,
  createdAt: '2026-01-01',
};
const channel = {
  id: 'design',
  type: 'channel',
  name: 'Design',
  ownerId: 'viewer',
  channelType: 'team',
} as ChannelEntity;

let setChannel: Setter<ChannelEntity | undefined>;
beforeEach(() => {
  vi.clearAllMocks();
  const [loaded, update] = createSignal<ChannelEntity | undefined>(undefined);
  setChannel = update;
  rail.channelById = (channelId) =>
    loaded()?.id === channelId ? loaded() : undefined;
});
afterEach(cleanup);

describe('favorite rows in the chat rail', () => {
  it('gives a favorited channel its channel actions, aimed at the favorite row', () => {
    setChannel(channel);
    render(() => <ChannelFavoriteRow favorite={favorite} />);

    const menu = screen.getByTestId('channel-actions');
    expect(menu.getAttribute('data-channel')).toBe('design');
    expect(menu.getAttribute('data-row-id')).toBe('favorite:channel:design');
    expect(screen.getByTestId('label-actions')).toBeTruthy();
    expect(screen.queryByTestId('favorite-actions')).toBeNull();
  });

  it('keeps the shared favorite actions until the channel loads', () => {
    render(() => <ChannelFavoriteRow favorite={favorite} />);

    expect(
      screen.getByTestId('favorite-actions').getAttribute('data-entity')
    ).toBe('design');
    expect(screen.queryByTestId('channel-actions')).toBeNull();
    const row = screen.getByRole('treeitem');

    setChannel(channel);
    expect(screen.getByTestId('channel-actions')).toBeTruthy();
    expect(screen.queryByTestId('favorite-actions')).toBeNull();
    expect(screen.getByRole('treeitem')).toBe(row);
  });

  it('focuses the favorite row when the fallback menu opens', () => {
    render(() => <ChannelFavoriteRow favorite={favorite} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open favorite menu' }));
    expect(rail.list.focus.set).toHaveBeenCalledWith(
      'favorite:channel:design',
      { reason: 'pointer', force: true }
    );
  });

  it('still activates the favorite row on click', () => {
    render(() => <ChannelFavoriteRow favorite={favorite} />);

    fireEvent.click(screen.getByRole('treeitem'));
    expect(rail.activateRow).toHaveBeenCalledWith(
      'favorite:channel:design',
      expect.anything()
    );
  });
});
