import type { ChannelEntity } from '@entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@solidjs/testing-library';
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
import { ChannelFavoriteRow as DraggableFavoriteRow } from './next/ChannelFavoriteRow';
import {
  reorderVisibleFavorites,
  useFavoriteReorder,
} from './next/useFavoriteReorder';

const rail = vi.hoisted(() => ({
  channelById: (_channelId: string): ChannelEntity | undefined => undefined,
  activateRow: vi.fn(),
  prefetchRow: vi.fn(),
  list: { focus: { set: vi.fn() } },
  railId: 'rail',
  sectionPreferences: () => ({ sort: 'manual' }),
}));

const drag = vi.hoisted(() => ({
  starts: [] as Array<
    (event: { draggable: { data: Record<string, unknown> } }) => void
  >,
  ends: [] as Array<
    (event: {
      draggable: { data: Record<string, unknown> };
      droppable: { data: Record<string, unknown> };
    }) => void
  >,
  favorites: [] as Favorite[],
  reorder: vi.fn(
    async (_args: {
      favorites: { entityId: string; entityType: string }[];
    }) => ({ kind: 'committed' })
  ),
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => ({ favorites: drag.favorites }),
  useReorderFavoritesMutation: () => ({ mutateAsync: drag.reorder }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: async (
      _name: string,
      run: (span: { setAttr: () => void }) => Promise<void>
    ) => await run({ setAttr() {} }),
  },
}));
vi.mock('@thisbeyond/solid-dnd', () => ({
  createDraggable: () => ({
    ref() {},
    dragActivators: {},
    isActiveDraggable: false,
  }),
  createDroppable: () => ({ ref() {}, isActiveDroppable: false }),
  useDragDropContext: () => [
    { active: {} },
    {
      onDragStart: (callback: (typeof drag.starts)[number]) =>
        drag.starts.push(callback),
      onDragEnd: (callback: (typeof drag.ends)[number]) =>
        drag.ends.push(callback),
    },
  ],
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
    muted: false,
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
vi.mock('./next/ChannelLabelRows', () => ({
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
  drag.starts.length = 0;
  drag.ends.length = 0;
  drag.favorites = [];
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

describe('favorite reordering', () => {
  const first: Favorite = { ...favorite, entityId: 'first' };
  const last: Favorite = { ...favorite, entityId: 'last' };
  const hidden: Favorite = { ...favorite, entityId: 'hidden' };
  const document: Favorite = {
    ...favorite,
    entityType: 'document',
    entityId: 'first',
  };
  const original = [first, document, hidden, last];

  it('moves visible favorites without moving hidden or other-type slots', () => {
    expect(
      reorderVisibleFavorites(
        original,
        [first, last],
        'favorite:channel:last',
        'favorite:channel:first'
      )
    ).toEqual([last, document, hidden, first]);
    expect(original).toEqual([first, document, hidden, last]);
  });

  it('ignores self drops, missing targets, and incomplete favorite snapshots', () => {
    expect(
      reorderVisibleFavorites(
        original,
        [first, last],
        'favorite:channel:first',
        'favorite:channel:first'
      )
    ).toBeUndefined();
    expect(
      reorderVisibleFavorites(
        original,
        [first, last],
        'favorite:channel:first',
        'favorite:channel:missing'
      )
    ).toBeUndefined();
    expect(
      reorderVisibleFavorites(
        [first],
        [first, last],
        'favorite:channel:first',
        'favorite:channel:last'
      )
    ).toBeUndefined();
  });

  it('sends the complete reordered list through the shared mutation', async () => {
    drag.favorites = original;
    renderHook(() => useFavoriteReorder(() => [first, last]));
    const source = {
      data: {
        dndScope: 'rail:favorites',
        favoriteKey: 'favorite:channel:last',
      },
    };
    const target = {
      data: {
        dndScope: 'rail:favorites',
        favoriteKey: 'favorite:channel:first',
      },
    };
    drag.starts.forEach((start) => start({ draggable: source }));
    drag.ends.forEach((end) => end({ draggable: source, droppable: target }));
    await waitFor(() =>
      expect(drag.reorder).toHaveBeenCalledExactlyOnceWith({
        favorites: [last, document, hidden, first].map(
          ({ entityId, entityType }) => ({ entityId, entityType })
        ),
      })
    );
  });

  it('suppresses drag clicks without blocking keyboard or later pointer activation', () => {
    render(() => (
      <DraggableFavoriteRow
        favorite={favorite}
        reorder={{ scope: 'rail:favorites', enabled: () => true }}
      />
    ));
    drag.starts.forEach((start) =>
      start({
        draggable: {
          data: {
            dndScope: 'rail:favorites',
            favoriteKey: 'favorite:channel:design',
          },
        },
      })
    );
    fireEvent.click(screen.getByRole('treeitem'), { detail: 1 });
    expect(rail.activateRow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('treeitem'), { detail: 0 });
    expect(rail.activateRow).toHaveBeenCalledOnce();
    fireEvent.pointerDown(screen.getByRole('treeitem'));
    fireEvent.click(screen.getByRole('treeitem'), { detail: 1 });
    expect(rail.activateRow).toHaveBeenCalledTimes(2);
  });
});
