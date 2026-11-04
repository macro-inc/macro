import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
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
import { clampChannelSectionHeight } from '../../constants';
import { ChannelFavoriteRow } from './ChannelFavoriteRows';
import { ChannelOption } from './ChannelOption';
import { ChannelFavoriteRow as DraggableFavoriteRow } from './next/ChannelFavoriteRow';
import {
  ChannelSectionHeading,
  DraggableChannelSectionHeading,
} from './next/ChannelSectionHeading';
import { ResizableRailSection } from './next/ResizableRailSection';
import {
  reorderVisibleFavorites,
  useFavoriteReorder,
} from './next/useFavoriteReorder';

import { useSectionReorder } from './next/useSectionReorder';

const measurements = vi.hoisted(() => ({ contentHeight: (): number => 400 }));
const rail = vi.hoisted(() => ({
  channelById: (_channelId: string): ChannelEntity | undefined => undefined,
  activateRow: vi.fn(),
  prefetchRow: vi.fn(),
  list: { focus: { set: vi.fn() } },
  railId: 'rail',
  sectionPreferences: () => ({ sort: 'manual' }),
  setSectionPreferences: vi.fn(),
  setSectionOrder: vi.fn(),
  sectionOrder: (): readonly import('../../types').ChannelSectionKey[] => [],
  labels: (): ChannelLabel[] => [],
  labelsAvailable: () => true,
  sectionsEnabled: () => true,
  activeDropTarget: () => undefined,
}));

const drag = vi.hoisted(() => ({
  activate: vi.fn(),
  viewer: (): string => 'viewer',
  starts: [] as Array<
    (event: {
      draggable: { id?: string; data: Record<string, unknown> };
    }) => void
  >,
  ends: [] as Array<
    (event: {
      draggable: { data: Record<string, unknown> };
      droppable: { data: Record<string, unknown> };
    }) => void
  >,
  favorites: [] as Favorite[],
  draggables: new Map<string, Record<string, unknown>>(),
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
vi.mock('@core/context/user', () => ({ useUserId: () => () => drag.viewer() }));
vi.mock('@app/components/drag-drop/create-distance-pointer-sensor', () => ({
  createDistancePointerSensor: () => ({
    start: (_event: MouseEvent, id: string) => drag.activate(id),
    cancel: vi.fn(),
  }),
}));
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: {
    span: async (
      _name: string,
      run: (span: { setAttr: () => void }) => Promise<void>
    ) => await run({ setAttr() {} }),
  },
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: (element: () => HTMLElement | undefined) => ({
    width: 200,
    get height() {
      return element()?.hasAttribute('data-section-content')
        ? measurements.contentHeight()
        : 100;
    },
  }),
}));
vi.mock('@thisbeyond/solid-dnd', () => ({
  createDraggable: (id: string, data: Record<string, unknown>) => {
    drag.draggables.set(id, data);
    return {
      ref() {},
      dragActivators: { onMouseDown: () => drag.activate(id) },
      isActiveDraggable: false,
    };
  },
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
  useChannelRailItemState: () => () => ({
    domId: 'rail-channel-row',
    selected: false,
    focused: false,
    muted: false,
  }),
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
  ChannelAvatar: () => <span />,
  ChannelCallIndicator: () => null,
  IncomingCallActions: () => null,
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
vi.mock('@app/components/view-shell/ViewSidebar', () => ({
  ViewSidebar: { Control: () => null },
}));
vi.mock('@app/components/view-shell', async () => ({
  CollapsibleSection: (
    await import('@app/components/view-shell/CollapsibleSection')
  ).CollapsibleSection,
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
vi.mock('@ui', async () => ({
  Button: (
    props: ComponentProps<'button'> & {
      variant?: string;
      size?: string;
      tooltip?: string;
    }
  ) => {
    const [, rest] = splitProps(props, ['variant', 'size', 'tooltip']);
    return <button {...rest} />;
  },
  Tooltip: (await import('@ui/components/Tooltip')).Tooltip,
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
  drag.draggables.clear();
  rail.labels = () => [];
  rail.sectionPreferences = () => ({ sort: 'manual' });
  rail.sectionOrder = () => [];
  drag.favorites = [];
  drag.viewer = () => 'viewer';
  const [loaded, update] = createSignal<ChannelEntity | undefined>(undefined);
  [measurements.contentHeight] = createSignal(400);
  setChannel = update;
  rail.channelById = (channelId) =>
    loaded()?.id === channelId ? loaded() : undefined;
});
afterEach(cleanup);

describe('section heading dragging', () => {
  it('drags from the name without toggling after a drop or dragging action buttons', () => {
    const toggle = vi.fn();
    const move = vi.fn();
    render(() => (
      <DraggableChannelSectionHeading
        section="channels"
        label="Channels"
        reorder={{
          scope: 'rail:sections',
          dropEdge: () => undefined,
          isDragging: () => false,
          cancel: vi.fn(),
          move,
        }}
      >
        <ChannelSectionHeading
          id="channels-heading"
          label="Channels"
          open
          focused={false}
          unreadCount={0}
          onToggle={toggle}
        >
          <button type="button">Actions</button>
        </ChannelSectionHeading>
      </DraggableChannelSectionHeading>
    ));
    const heading = screen.getByRole('treeitem');

    fireEvent.pointerDown(heading);
    fireEvent.mouseDown(heading);
    expect(drag.activate).toHaveBeenCalledWith('rail:sections:channels');
    fireEvent.click(heading, { detail: 1 });
    expect(toggle).toHaveBeenCalledOnce();

    fireEvent.pointerDown(heading);
    for (const start of drag.starts) {
      start({ draggable: { id: 'rail:sections:channels', data: {} } });
    }
    fireEvent.click(heading, { detail: 1 });
    expect(toggle).toHaveBeenCalledOnce();

    drag.activate.mockClear();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Actions' }));
    expect(drag.activate).not.toHaveBeenCalled();
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reorder Channels' }),
      {
        key: 'ArrowDown',
      }
    );
    expect(move).toHaveBeenCalledWith('channels', 1);
  });
});

describe('channel section drag sources', () => {
  it('keeps the drag identity current when a virtual row is reused', () => {
    const [current, setCurrent] = createSignal(channel);
    render(() => <ChannelOption channel={current()} draggable />);
    const data = drag.draggables.get('rail:channel-label:drag:channel:design');

    setCurrent({ ...channel, id: 'updated', name: 'Updated' });

    expect(data?.channelId).toBe('updated');
    expect(data?.name).toBe('Updated');
  });
  it('keeps each rendered section as the drag source when a channel belongs to both scopes', () => {
    rail.labels = () => [
      {
        id: 'shared',
        name: 'Shared',
        teamId: 'team',
        channelIds: ['design'],
        channelCount: 1,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'personal',
        name: 'Personal',
        channelIds: ['design'],
        channelCount: 1,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];
    render(() => (
      <>
        <ChannelOption
          channel={channel}
          rowId="channel:design:label:shared"
          labelId="shared"
          draggable
        />
        <ChannelOption
          channel={channel}
          rowId="channel:design:label:personal"
          labelId="personal"
          draggable
        />
        <ChannelOption channel={channel} draggable />
      </>
    ));

    expect(
      drag.draggables.get('rail:channel-label:drag:channel:design:label:shared')
        ?.labelId
    ).toBe('shared');
    expect(
      drag.draggables.get(
        'rail:channel-label:drag:channel:design:label:personal'
      )?.labelId
    ).toBe('personal');
    expect(
      drag.draggables.get('rail:channel-label:drag:channel:design')?.labelId
    ).toBe('shared');
  });
});

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
        reorder={{
          scope: 'rail:favorites',
          enabled: () => true,
          dropEdge: () => undefined,
        }}
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

describe('section reordering', () => {
  it('keeps absent sections in their saved positions during keyboard reordering', () => {
    rail.sectionOrder = () => ['favorites', 'channels', 'label:section'];
    const { result } = renderHook(() =>
      useSectionReorder(
        () => ['favorites', 'label:section'],
        (reorder) => reorder()
      )
    );
    result.move('label:section', -1);
    expect(rail.setSectionOrder).toHaveBeenCalledExactlyOnceWith([
      'label:section',
      'channels',
      'favorites',
    ]);
  });

  it('preserves hidden sections and ignores stale drops after account changes', () => {
    const [viewer, setViewer] = createSignal('viewer');
    drag.viewer = viewer;
    const { result } = renderHook(() =>
      useSectionReorder(
        () => ['favorites', 'label:collapsed', 'channels'],
        (reorder) => reorder()
      )
    );
    const source = { data: { dndScope: result.scope, section: 'channels' } };
    const target = { data: { dndScope: result.scope, section: 'favorites' } };
    drag.starts.forEach((start) => start({ draggable: source }));
    drag.ends.forEach((end) => end({ draggable: source, droppable: target }));
    expect(rail.setSectionOrder).toHaveBeenCalledExactlyOnceWith([
      'channels',
      'favorites',
      'label:collapsed',
    ]);

    setViewer('another-viewer');
    drag.ends.forEach((end) => end({ draggable: source, droppable: target }));
    expect(rail.setSectionOrder).toHaveBeenCalledTimes(1);
  });
});

describe('resizable chat sections', () => {
  it('caps every section to its available height while preserving manual heights', () => {
    const [maximum, setMaximum] = createSignal(400);
    const [savedHeight, setSavedHeight] = createSignal<number>();
    rail.sectionPreferences = () => ({ sort: 'manual', height: savedHeight() });
    measurements.contentHeight = () => 1360;
    let viewport!: HTMLDivElement;
    render(() => (
      <ResizableRailSection
        section="team_channels"
        label="Team channels"
        open
        maxHeight={maximum()}
        itemCount={40}
        header={<span>Section</span>}
        rootRef={() => {}}
        scrollRef={(element) => {
          viewport = element;
        }}
      >
        Conversations
      </ResizableRailSection>
    ));

    expect(viewport.style.height).toBe('400px');
    setMaximum(252);
    expect(viewport.style.height).toBe('252px');

    setSavedHeight(180);
    expect(viewport.style.height).toBe('180px');
    setMaximum(400);
    expect(viewport.style.height).toBe('180px');

    setSavedHeight(1100);
    expect(viewport.style.height).toBe('400px');
    expect(clampChannelSectionHeight(1100)).toBe(1100);
    setSavedHeight(180);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
    expect(rail.setSectionPreferences).toHaveBeenCalledWith('team_channels', {
      height: 200,
    });
  });

  it('saves the final zoom-adjusted size and can resize again after collapse cancels a drag', () => {
    const [open, setOpen] = createSignal(true);
    render(() => (
      <ResizableRailSection
        section="favorites"
        label="Favorites"
        open={open()}
        maxHeight={400}
        itemCount={12}
        header={<span>Section</span>}
        rootRef={() => {}}
        scrollRef={(element) => {
          Object.defineProperty(element, 'offsetHeight', { value: 100 });
          vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(0, 0, 200, 200)
          );
        }}
      >
        Conversations
      </ResizableRailSection>
    ));
    let handle = screen.getByRole('separator');
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    for (const [type, y] of [
      ['pointerdown', 100],
      ['pointermove', 140],
      ['pointerup', 180],
    ] as const) {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientY: y,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      handle.dispatchEvent(event);
    }
    expect(rail.setSectionPreferences).toHaveBeenCalledExactlyOnceWith(
      'favorites',
      { height: 140 }
    );
    const start = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    });
    Object.defineProperty(start, 'pointerId', { value: 1 });
    handle.dispatchEvent(start);
    setOpen(false);
    expect(rail.setSectionPreferences).toHaveBeenCalledTimes(1);
    setOpen(true);
    handle = screen.getByRole('separator');
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    for (const [type, y] of [
      ['pointerdown', 100],
      ['pointerup', 160],
    ] as const) {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientY: y,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      handle.dispatchEvent(event);
    }
    expect(rail.setSectionPreferences).toHaveBeenLastCalledWith('favorites', {
      height: 130,
    });
  });

  it('compensates for sidebar scrolling during a resize drag', () => {
    let top = 100;
    render(() => (
      <ResizableRailSection
        section="favorites"
        label="Favorites"
        open
        maxHeight={400}
        itemCount={12}
        header={<span>Section</span>}
        rootRef={() => {}}
        scrollRef={(element) => {
          Object.defineProperty(element, 'offsetHeight', { value: 136 });
          vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
            () => new DOMRect(0, top, 200, 136)
          );
        }}
      >
        Conversations
      </ResizableRailSection>
    ));
    const handle = screen.getByRole('separator');
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    const start = new MouseEvent('pointerdown', {
      bubbles: true,
      clientY: 236,
    });
    Object.defineProperty(start, 'pointerId', { value: 1 });
    handle.dispatchEvent(start);
    top = 50;
    const end = new MouseEvent('pointerup', { bubbles: true, clientY: 236 });
    Object.defineProperty(end, 'pointerId', { value: 1 });
    handle.dispatchEvent(end);

    expect(rail.setSectionPreferences).toHaveBeenLastCalledWith('favorites', {
      height: 186,
    });
  });

  it.each(['pointerup', 'pointercancel'])(
    'scrolls while resizing near the sidebar edge and stops on %s',
    (endEvent) => {
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      const request = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((callback) => {
          frames.set(++frameId, callback);
          return frameId;
        });
      const cancel = vi
        .spyOn(window, 'cancelAnimationFrame')
        .mockImplementation((id) => {
          frames.delete(id);
        });
      const outer = document.createElement('div');
      Object.defineProperties(outer, {
        clientHeight: { value: 280 },
        scrollHeight: { value: 800 },
      });
      vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 200, 280)
      );
      let viewport!: HTMLDivElement;
      const view = render(() => (
        <ResizableRailSection
          section="favorites"
          label="Favorites"
          open
          maxHeight={400}
          itemCount={12}
          outerScrollRoot={outer}
          header={<span>Section</span>}
          rootRef={() => {}}
          scrollRef={(element) => {
            viewport = element;
            Object.defineProperty(element, 'offsetHeight', { value: 136 });
            vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
              () => new DOMRect(0, 132 - outer.scrollTop, 200, 136)
            );
          }}
        >
          Conversations
        </ResizableRailSection>
      ));
      const handle = screen.getByRole('separator');
      Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
      const start = new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 268,
      });
      Object.defineProperty(start, 'pointerId', { value: 1 });
      handle.dispatchEvent(start);

      for (const time of [0, 16, 32]) {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(time);
      }

      expect(outer.scrollTop).toBeGreaterThan(0);
      expect(Number.parseFloat(viewport.style.height)).toBe(
        Math.round(136 + outer.scrollTop)
      );
      const end = new MouseEvent(endEvent, {
        bubbles: true,
        clientX: 100,
        clientY: 268,
      });
      Object.defineProperty(end, 'pointerId', { value: 1 });
      handle.dispatchEvent(end);
      expect(frames.size).toBe(0);
      if (endEvent === 'pointerup') {
        expect(rail.setSectionPreferences).toHaveBeenCalledExactlyOnceWith(
          'favorites',
          { height: Math.round(136 + outer.scrollTop) }
        );
      } else {
        expect(rail.setSectionPreferences).not.toHaveBeenCalled();
      }

      view.unmount();
      request.mockRestore();
      cancel.mockRestore();
    }
  );

  it.each(['pointercancel', 'lostpointercapture'])(
    'does not save after %s and accepts a later resize',
    (cancelEvent) => {
      render(() => (
        <ResizableRailSection
          section="favorites"
          label="Favorites"
          open
          maxHeight={400}
          itemCount={12}
          header={<span>Section</span>}
          rootRef={() => {}}
          scrollRef={(element) => {
            Object.defineProperty(element, 'offsetHeight', { value: 136 });
            vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
              new DOMRect(0, 0, 200, 136)
            );
          }}
        >
          Conversations
        </ResizableRailSection>
      ));
      const handle = screen.getByRole('separator');
      Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
      for (const type of [
        'pointerdown',
        'pointermove',
        cancelEvent,
        'pointerup',
      ]) {
        const event = new MouseEvent(type, {
          bubbles: true,
          clientY: type === 'pointerdown' ? 136 : 200,
        });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        handle.dispatchEvent(event);
      }
      expect(rail.setSectionPreferences).not.toHaveBeenCalled();

      for (const type of ['pointerdown', 'pointerup']) {
        const event = new MouseEvent(type, {
          bubbles: true,
          clientY: type === 'pointerdown' ? 136 : 180,
        });
        Object.defineProperty(event, 'pointerId', { value: 2 });
        handle.dispatchEvent(event);
      }
      expect(rail.setSectionPreferences).toHaveBeenCalledExactlyOnceWith(
        'favorites',
        { height: 180 }
      );
    }
  );

  it('clamps keyboard resizing and resets only the section height', () => {
    render(() => (
      <ResizableRailSection
        section="favorites"
        label="Favorites"
        open
        maxHeight={120}
        itemCount={4}
        header={<span>Section</span>}
        rootRef={() => {}}
        scrollRef={() => {}}
      >
        Conversations
      </ResizableRailSection>
    ));
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(rail.setSectionPreferences).toHaveBeenLastCalledWith('favorites', {
      height: 68,
    });
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(rail.setSectionPreferences).toHaveBeenLastCalledWith('favorites', {
      height: 120,
    });
    fireEvent.dblClick(handle);
    expect(rail.setSectionPreferences).toHaveBeenLastCalledWith('favorites', {
      height: undefined,
    });
  });

  it('caps resizing at the content height and drops the handle when filtering leaves two items', () => {
    const [count, setCount] = createSignal(3);
    const [contentHeight, setContentHeight] = createSignal(102);
    measurements.contentHeight = contentHeight;
    let scrollElement: HTMLDivElement | undefined;
    render(() => (
      <ResizableRailSection
        section="team_channels"
        label="Team channels"
        open
        maxHeight={400}
        itemCount={count()}
        header={<span>Section</span>}
        rootRef={() => {}}
        scrollRef={(element) => {
          scrollElement = element;
        }}
      >
        Conversations
      </ResizableRailSection>
    ));
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-valuemax')).toBe('102');
    expect(handle.getAttribute('aria-valuenow')).toBe('102');
    expect(scrollElement?.style.height).toBe('102px');
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(rail.setSectionPreferences).toHaveBeenLastCalledWith(
      'team_channels',
      { height: 102 }
    );

    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    const start = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    });
    Object.defineProperty(start, 'pointerId', { value: 1 });
    handle.dispatchEvent(start);
    setCount(2);
    setContentHeight(68);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(scrollElement?.style.height).toBe('68px');
    const finish = new MouseEvent('pointerup', { bubbles: true, clientY: 300 });
    Object.defineProperty(finish, 'pointerId', { value: 1 });
    handle.dispatchEvent(finish);
    expect(rail.setSectionPreferences).toHaveBeenCalledTimes(1);
  });

  it.each(['favorites', 'direct_messages', 'team_channels'] as const)(
    'uses the default height for %s within the content and viewport limits',
    (section) => {
      render(() => (
        <ResizableRailSection
          section={section}
          label={section}
          open
          maxHeight={300}
          itemCount={12}
          header={<span>Section</span>}
          rootRef={() => {}}
          scrollRef={() => {}}
        >
          Conversations
        </ResizableRailSection>
      ));
      expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
        section === 'team_channels' ? '300' : '136'
      );
    }
  );
});
