import { createDragAutoScroll } from '@app/components/drag-drop/create-drag-auto-scroll';
import { createLayoutAnimation } from '@app/components/drag-drop/create-layout-animation';
import type { ListScrollHandle } from '@app/components/list';
import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { SlackImportSidebar } from '@app/features/slack-import/slack-import-sidebar';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  CHANNEL_SECTION_MAX_HEIGHT,
  CHANNEL_SECTION_MIN_HEIGHT,
  CHANNEL_SECTION_ROW_HEIGHT,
} from '../../../constants';
import { canLabelChannel } from '../../../core/channel-label-eligibility';
import { ChannelsLiveCallsSidebar } from '../../../live-calls-sidebar';
import { CHANNELS_TOUR } from '../../../tour';
import type { ChannelSectionKey, ChannelsGroup } from '../../../types';
import { ConversationsCreateMenu } from '../../ConversationsCreateMenu';
import { ChannelOption } from '../ChannelOption';
import {
  type ChannelRailRow,
  domIdForRow,
  rowKeyForSection,
  useChannelsRail,
} from '../ChannelsRailContext';
import {
  RailListError,
  RailListLoading,
  RailListLoadingMore,
} from '../ChannelsRailSection';
import {
  type ChannelRailSectionRows,
  groupChannelRailSections,
} from './build-channel-rail-rows';
import { ChannelFavoriteRow } from './ChannelFavoriteRow';
import { ChannelLabelEmptyState, ChannelLabelRow } from './ChannelLabelRows';
import {
  ChannelRailVirtualizer,
  type ChannelRailVirtualizerHandle,
} from './ChannelRailVirtualizer';
import { ChannelSectionDropZone } from './ChannelSectionDropZone';
import { ChannelSectionEmptyState } from './ChannelSectionEmptyState';
import {
  ChannelSectionHeading,
  DraggableChannelSectionHeading,
} from './ChannelSectionHeading';
import {
  ChannelSectionContextMenu,
  ChannelSectionDropdown,
} from './ChannelSectionMenu';
import { ResizableRailSection } from './ResizableRailSection';
import { useFavoriteReorder } from './useFavoriteReorder';
import { useSectionReorder } from './useSectionReorder';

type ChannelRailSearch = {
  isOpen: Accessor<boolean>;
  query: Accessor<string>;
  results: Accessor<readonly ChannelEntity[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<unknown | undefined>;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  registerInput: (element: HTMLInputElement) => void;
  retry: () => Promise<void>;
};

function ExpandedHeader(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();

  return (
    <div class="flex shrink-0 flex-col">
      <ViewSidebar.Header
        searchLabel={t('channelSections.search')}
        searchOpen={props.search.isOpen()}
        onSearchOpenChange={(open) => {
          if (open) {
            props.search.open();
          } else {
            props.search.close();
          }
        }}
        search={() => (
          <SearchBar
            ref={props.search.registerInput}
            label={t('channelSections.search')}
            placeholder={t('channelSections.search')}
            value={props.search.query()}
            hotkey="cmd+f"
            onValueChange={props.search.setQuery}
            onEscape={() => {
              if (!props.search.query()) {
                props.search.close();
              }
            }}
          />
        )}
      >
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>{t('channelSections.chat')}</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <ConversationsCreateMenu
            presentation="sidebar"
            onCreateSection={
              rail.channelTagsEnabled()
                ? () => fireAndForget(rail.createLabel([]), 'channels-view')
                : undefined
            }
            sectionDisabledReason={
              !rail.labelsAvailable()
                ? rail.labelsUnavailableReason()
                : undefined
            }
          />
        </div>
      </ViewSidebar.Primary>
      <Show when={rail.labelsFailed()}>
        <div
          class="flex items-center gap-2 px-3 text-xs text-ink-muted"
          role="status"
        >
          <span class="min-w-0 flex-1">{rail.labelsUnavailableReason()}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fireAndForget(rail.retryLabels(), 'channels-view')}
          >
            {t('channelSections.retry')}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function SectionHeading(props: { group: 'favorites' | ChannelsGroup }) {
  const rail = useChannelsRail();
  const team = useCurrentTeamQuery(() => props.group === 'team_channels');
  const title = () => {
    if (props.group === 'team_channels' && queryReadyGate(team)) {
      const teamName = team.data?.team.name;

      if (teamName) {
        return t('channelSections.namedTeamChannels', { name: teamName });
      }
    }

    if (props.group === 'channels') {
      return t('channelSections.allChannels');
    }
    return t(`channelSections.${props.group}`);
  };

  const open = () => rail.isGroupOpen(props.group);
  const key = () => rowKeyForSection(props.group);
  const channelGroup = () =>
    props.group === 'favorites' ? undefined : props.group;
  const unreadCount = () => {
    const group = channelGroup();
    return group ? rail.channelActivity.unreadCount(group) : 0;
  };

  return (
    <ChannelSectionContextMenu section={props.group}>
      <ChannelSectionHeading
        id={domIdForRow(rail.railId, key())}
        tooltip={title()}
        label={title()}
        open={open()}
        focused={rail.list.focus.key() === key()}
        unreadCount={unreadCount()}
        onToggle={() => rail.toggleGroup(props.group)}
      >
        <ChannelSectionDropdown section={props.group} label={title()} />
      </ChannelSectionHeading>
    </ChannelSectionContextMenu>
  );
}

function SectionStatus(props: { group: ChannelsGroup }) {
  const rail = useChannelsRail();
  const source = () => rail.sources[props.group];
  const hasConversations = () =>
    rail.list.items
      .all()
      .some(
        (row) =>
          row.kind === 'conversation' &&
          row.group === props.group &&
          !row.labelId
      );

  return (
    <div>
      <Switch>
        <Match when={source().isLoading() || source().isLoadingMore()}>
          <RailListLoadingMore variant="channel" />
        </Match>
        <Match when={source().error()}>
          <RailListError retry={source().refresh} compact />
        </Match>
        <Match when={source().hasMore()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fireAndForget(source().loadMore(), 'channels-view')}
          >
            {t('channelSections.loadMore')}
          </Button>
        </Match>
        <Match when={!hasConversations()}>
          <ChannelSectionEmptyState>
            {rail.sectionPreferences(props.group).unreadOnly
              ? t('channelSections.noUnreadConversations')
              : t('channelSections.empty')}
          </ChannelSectionEmptyState>
        </Match>
      </Switch>
    </div>
  );
}

function BrowseRow(props: {
  row: ChannelRailRow;
  favoriteReorder: ReturnType<typeof useFavoriteReorder>;
}) {
  const rail = useChannelsRail();

  return (
    <div
      classList={{
        'pl-2':
          props.row.kind === 'favorite' ||
          props.row.kind === 'conversation' ||
          props.row.kind === 'status' ||
          props.row.kind === 'reference-status',
      }}
    >
      <Switch>
        <Match when={props.row.kind === 'section' ? props.row : undefined}>
          {(row) => <SectionHeading group={row().group} />}
        </Match>
        <Match when={props.row.kind === 'status' ? props.row : undefined}>
          {(row) => <SectionStatus group={row().group} />}
        </Match>
        <Match
          when={props.row.kind === 'reference-status' ? props.row : undefined}
        >
          {(row) => (
            <Show
              when={row().state === 'loading'}
              fallback={
                <RailListError retry={rail.retryReferencedChannels} compact />
              }
            >
              <RailListLoadingMore variant="channel" />
            </Show>
          )}
        </Match>
        <Match when={props.row.kind === 'label' ? props.row : undefined}>
          {(row) => <ChannelLabelRow label={row().label} />}
        </Match>
        <Match when={props.row.kind === 'favorite' ? props.row : undefined}>
          {(row) => (
            <ChannelFavoriteRow
              favorite={row().favorite}
              reorder={props.favoriteReorder}
            />
          )}
        </Match>
        <Match when={props.row.kind === 'conversation' ? props.row : undefined}>
          {(row) => (
            <ChannelOption
              channel={row().channel}
              rowId={row().id}
              labelId={row().labelId}
              draggable={canLabelChannel(row().channel)}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

type SectionHandle = {
  layout?: HTMLDivElement;
  root?: HTMLDivElement;
  virtualizer?: ChannelRailVirtualizerHandle;
  viewport?: HTMLDivElement;
  outerScroll?: boolean;
};

function BrowseSection(props: {
  sectionKey: ChannelSectionKey;
  section: ChannelRailSectionRows;
  maxHeight: number;
  outerScrollRoot: HTMLDivElement | undefined;
  layoutVersion: number;
  sectionOrder: readonly ChannelSectionKey[];
  scrollVersion: number;
  savedScrollTop: number;
  onReady: () => void;
  onPointerDown: () => void;
  favoriteReorder: ReturnType<typeof useFavoriteReorder>;
  sectionReorder: ReturnType<typeof useSectionReorder>;
  register: (key: ChannelSectionKey, handle: SectionHandle) => () => void;
}) {
  const rail = useChannelsRail();
  const handle: SectionHandle = {};
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] =
    createSignal<ChannelRailVirtualizerHandle>();
  const size = createElementSize(scrollRoot);
  const [resizing, setResizing] = createSignal(false);
  const [startMargin, setStartMargin] = createSignal(0);
  const outerScroll = () =>
    props.maxHeight === Number.POSITIVE_INFINITY &&
    rail.sectionPreferences(props.sectionKey).height === undefined &&
    !resizing();
  const rowsScrollRoot = () =>
    outerScroll() ? props.outerScrollRoot : scrollRoot();
  const droppable = createDroppable(
    `${props.sectionReorder.scope}:${props.sectionKey}`,
    {
      dragType: 'channel-section-target',
      dndScope: props.sectionReorder.scope,
      section: props.sectionKey,
    }
  );

  onCleanup(props.register(props.sectionKey, handle));
  onMount(() => {
    const viewport = scrollRoot();
    if (viewport && !outerScroll()) viewport.scrollTop = props.savedScrollTop;
  });

  createEffect(
    on(
      [
        scrollRoot,
        outerScroll,
        () => props.layoutVersion,
        () => props.sectionOrder,
        () => size.height,
      ],
      () => {
        if (!outerScroll()) return;
        const frame = requestAnimationFrame(() => {
          let element: HTMLElement | undefined = scrollRoot();
          let offset = 0;
          while (element && element !== props.outerScrollRoot) {
            offset += element.offsetTop;
            element =
              element.offsetParent instanceof HTMLElement
                ? element.offsetParent
                : undefined;
          }
          setStartMargin(offset);
        });
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );

  // Stable row IDs preserve in-flight pointer gestures during live updates.
  const rowsById = createMemo(
    () => new Map(props.section.rows.map((row) => [row.id, row]))
  );
  const rowIds = () => [...rowsById().keys()];
  const heading = () => props.section.heading;
  const customLabel = () => {
    const row = heading();
    return row.kind === 'label' ? row.label : undefined;
  };
  const open = () => {
    const row = heading();
    return row.kind === 'label'
      ? rail.isLabelOpen(row.label.id)
      : rail.isGroupOpen(row.group);
  };

  const itemCount = () =>
    props.section.rows.filter(
      (row) => row.kind === 'conversation' || row.kind === 'favorite'
    ).length;

  const label = () => {
    const row = heading();
    if (row.kind === 'section' && row.group === 'channels') {
      return t('channelSections.allChannels');
    }
    return row.kind === 'label'
      ? row.label.name
      : t(`channelSections.${row.group}`);
  };

  const emptyMessage = () => {
    if (rail.sectionPreferences(props.sectionKey).unreadOnly) {
      return t('channelSections.noUnreadConversations');
    }

    const row = heading();

    if (row.kind === 'section') {
      return t('channelSections.emptyFavorites');
    }

    return row.label.rule
      ? t('channelSections.emptySmartSection')
      : t('channelSections.emptySection');
  };

  const [dragState] = useDragDropContext() ?? [];
  const keepRows = createMemo(() => {
    const source = dragState?.active.draggable?.data;
    return props.section.rows.flatMap((row, index) => {
      if (row.id === rail.list.focus.key()) return [index];
      if (row.kind === 'conversation' && row.channel.id === source?.channelId)
        return [index];
      if (row.kind === 'favorite' && row.id === source?.favoriteKey)
        return [index];
      return [];
    });
  });
  const loadVisibleSections = () => {
    const current = virtualizer();

    if (!open() || !current) {
      return;
    }

    const viewport = scrollRoot();
    const outer = props.outerScrollRoot;
    if (!viewport || !outer) return;
    const bounds = viewport.getBoundingClientRect();
    const visible = outer.getBoundingClientRect();
    if (bounds.bottom <= visible.top || bounds.top >= visible.bottom) return;

    const range = current.visibleRange();
    if (!range) return;

    const first = Math.max(0, range.startIndex - 3);
    const last = range.endIndex + 5;
    for (const row of props.section.rows.slice(first, last + 1)) {
      if (row.kind !== 'status') {
        continue;
      }

      const source = rail.sources[row.group];

      if (source.hasMore() && !source.isFetching() && !source.error()) {
        fireAndForget(source.loadMore(), 'channels-view');
      }
    }
  };

  createEffect(
    on(
      [
        () => props.section.rows,
        open,
        virtualizer,
        () => size.height,
        () => props.scrollVersion,
      ],
      () => {
        if (!open()) {
          return;
        }

        const frame = requestAnimationFrame(loadVisibleSections);
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );

  const content = (
    <ResizableRailSection
      section={props.sectionKey}
      label={label()}
      open={open()}
      maxHeight={props.maxHeight}
      dropEdge={props.sectionReorder.dropEdge(props.sectionKey)}
      dragging={props.sectionReorder.isDragging(props.sectionKey)}
      itemCount={itemCount()}
      onResizingChange={setResizing}
      rootRef={(element) => {
        handle.root = element;
        droppable.ref(element);
      }}
      scrollRef={(element) => {
        setScrollRoot(element);
        handle.viewport = element;

        const row = heading();

        if (row.kind === 'section') {
          rail.registerScrollRef(row.group, element);
        }
      }}
      header={
        <DraggableChannelSectionHeading
          section={props.sectionKey}
          label={label()}
          reorder={props.sectionReorder}
        >
          <BrowseRow row={heading()} favoriteReorder={props.favoriteReorder} />
        </DraggableChannelSectionHeading>
      }
    >
      <Show
        when={props.section.rows.length > 0}
        fallback={
          <Show
            when={customLabel()}
            fallback={
              <ChannelSectionEmptyState>
                {emptyMessage()}
              </ChannelSectionEmptyState>
            }
          >
            {(label) => <ChannelLabelEmptyState label={label()} />}
          </Show>
        }
      >
        <ChannelRailVirtualizer
          ref={(current) => {
            handle.virtualizer = current;
            handle.outerScroll = outerScroll();
            setVirtualizer(current);
            if (current) props.onReady();
          }}
          keys={rowIds()}
          scrollRoot={rowsScrollRoot()}
          scrollMargin={outerScroll() ? startMargin() : 0}
          estimateSize={CHANNEL_SECTION_ROW_HEIGHT}
          keepMounted={keepRows()}
          onRangeChange={loadVisibleSections}
        >
          {(id) => (
            <Show when={rowsById().get(id)}>
              {(row) => (
                <BrowseRow
                  row={row()}
                  favoriteReorder={props.favoriteReorder}
                />
              )}
            </Show>
          )}
        </ChannelRailVirtualizer>
      </Show>
    </ResizableRailSection>
  );

  return (
    <div
      class="min-w-0 shrink-0 pb-0.5"
      on:pointerdown={{ capture: true, handleEvent: props.onPointerDown }}
      ref={(element) => {
        handle.layout = element;
      }}
    >
      <ChannelSectionDropZone section={props.sectionKey} label={customLabel()}>
        {content}
      </ChannelSectionDropZone>
    </div>
  );
}

function ExpandedBrowse() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [stackContent, setStackContent] = createSignal<HTMLDivElement>();
  const [stackVirtualizer, setStackVirtualizer] =
    createSignal<ChannelRailVirtualizerHandle>();
  const [scrollVersion, setScrollVersion] = createSignal(0);
  const [handlesVersion, setHandlesVersion] = createSignal(0);
  const [gestureSection, setGestureSection] = createSignal<ChannelSectionKey>();
  const [pendingScroll, setPendingScroll] = createSignal<{
    section: ChannelSectionKey;
    rowId: string;
    options: Parameters<ListScrollHandle['scrollToIndex']>[1];
    actorId: string | undefined;
  }>();
  const userId = useUserId();
  const scrollSize = createElementSize(scrollRoot);
  const stackSize = createElementSize(stackContent);
  const scrollOffsets = new Map<ChannelSectionKey, number>();
  const sections = createMemo(() =>
    groupChannelRailSections(rail.list.items.all())
  );
  const keys = createMemo(() => [...sections().keys()]);
  const rowSections = createMemo(() => {
    const lookup = new Map<string, ChannelSectionKey>();
    for (const [key, section] of sections()) {
      lookup.set(section.heading.id, key);
      for (const row of section.rows) lookup.set(row.id, key);
    }
    return lookup;
  });
  const maximumHeight = (key: ChannelSectionKey) => {
    const paneHeight = Math.min(
      CHANNEL_SECTION_MAX_HEIGHT,
      Math.max(CHANNEL_SECTION_MIN_HEIGHT, (scrollSize.height ?? 300) - 48)
    );

    if (key !== 'channels') {
      return paneHeight;
    }

    if (keys().at(-1) === key) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(paneHeight, rail.sectionPreferences(key).height ?? 0);
  };
  const handles = new Map<ChannelSectionKey, SectionHandle>();
  const motion = createLayoutAnimation({
    viewport: scrollRoot,
    items: () =>
      [...handles].flatMap(([key, handle]) =>
        handle.root && handle.layout
          ? [{ key, element: handle.root, layout: handle.layout }]
          : []
      ),
  });
  onCleanup(motion.cancel);

  const sectionReorder = useSectionReorder(keys, (reorder) => {
    const finish = motion.beginHover();

    try {
      reorder();
    } finally {
      finish();
    }
  });
  const [dragState, dragActions] = useDragDropContext() ?? [];
  const sidebarDragActive = () => {
    const scope = dragState?.active.draggable?.data.dndScope;
    return (
      scope === rail.railId ||
      scope === sectionReorder.scope ||
      scope === `${rail.railId}:favorites`
    );
  };
  const keepSections = createMemo(() => {
    if (sidebarDragActive()) return keys().map((_, index) => index);
    const retained = new Set([
      rowSections().get(rail.list.focus.key() ?? ''),
      gestureSection(),
      pendingScroll()?.section,
    ]);
    return keys().flatMap((key, index) => (retained.has(key) ? [index] : []));
  });
  let releaseFrame: number | undefined;
  const releaseGesture = () => {
    if (releaseFrame !== undefined) cancelAnimationFrame(releaseFrame);
    releaseFrame = requestAnimationFrame(() => setGestureSection(undefined));
  };
  window.addEventListener('pointerup', releaseGesture, true);
  window.addEventListener('pointercancel', releaseGesture, true);
  window.addEventListener('blur', releaseGesture);
  onCleanup(() => {
    window.removeEventListener('pointerup', releaseGesture, true);
    window.removeEventListener('pointercancel', releaseGesture, true);
    window.removeEventListener('blur', releaseGesture);
    if (releaseFrame !== undefined) cancelAnimationFrame(releaseFrame);
  });
  createEffect(
    on(
      userId,
      () => {
        scrollOffsets.clear();
        setPendingScroll(undefined);
        setGestureSection(undefined);
      },
      { defer: true }
    )
  );
  createEffect(
    on([sidebarDragActive, handlesVersion], () => {
      if (!sidebarDragActive()) return;
      const frame = requestAnimationFrame(() =>
        dragActions?.detectCollisions()
      );
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );
  createDragAutoScroll({
    getViewport: () => {
      const scope = dragState?.active.draggable?.data.dndScope;

      if (
        scope === rail.railId ||
        scope === sectionReorder.scope ||
        scope === `${rail.railId}:favorites`
      ) {
        return scrollRoot();
      }
    },
    axis: 'y',
  });

  // Wheel scrolling changes nested drop target positions during a drag too.
  const updateDropTarget = () => {
    setScrollVersion((version) => version + 1);
    if (dragState?.active.draggable) {
      dragActions?.detectCollisions();
    }
  };
  const favoriteReorder = useFavoriteReorder(
    () =>
      sections()
        .get('favorites')
        ?.rows.flatMap((row) =>
          row.kind === 'favorite' ? [row.favorite] : []
        ) ?? []
  );

  createScrollTopFade(scrollRoot);

  const ready = () => setHandlesVersion((version) => version + 1);
  const register = (key: ChannelSectionKey, handle: SectionHandle) => {
    handles.set(key, handle);
    return () => {
      if (handles.get(key) === handle) {
        if (handle.viewport && !handle.outerScroll) {
          scrollOffsets.set(key, handle.viewport.scrollTop);
        }
        handles.delete(key);
      }
    };
  };

  onCleanup(
    rail.registerBrowseScrollHandle({
      scrollToIndex: (index, options) => {
        const row = rail.list.items.at(index);
        const section = row && rowSections().get(row.id);
        if (!row || !section) return;

        setPendingScroll({
          section,
          rowId: row.id,
          options,
          actorId: userId(),
        });
        const outerRows =
          row.kind !== 'section' &&
          maximumHeight(section) === Number.POSITIVE_INFINITY &&
          rail.sectionPreferences(section).height === undefined;
        if (!outerRows) {
          stackVirtualizer()?.scrollToIndex(keys().indexOf(section), {
            align: 'nearest',
          });
        }
      },
    })
  );

  createEffect(
    on([pendingScroll, handlesVersion], () => {
      const request = pendingScroll();
      if (!request) return;
      if (request.actorId !== userId()) {
        setPendingScroll(undefined);
        return;
      }
      const section = sections().get(request.section);
      const handle = handles.get(request.section);
      if (!section || !handle?.root) return;
      const localIndex = section.rows.findIndex(
        (row) => row.id === request.rowId
      );
      if (localIndex >= 0 && !handle.virtualizer) return;

      const frame = requestAnimationFrame(() => {
        if (pendingScroll() !== request) return;
        const currentIndex =
          sections()
            .get(request.section)
            ?.rows.findIndex((row) => row.id === request.rowId) ?? -1;
        if (currentIndex >= 0) {
          handle.virtualizer?.scrollToIndex(currentIndex, request.options);
        }
        const container = scrollRoot();
        if (container && handle.root && !handle.outerScroll) {
          const bounds = handle.root.getBoundingClientRect();
          const viewport = container.getBoundingClientRect();
          if (bounds.top < viewport.top) {
            container.scrollTop += bounds.top - viewport.top;
          } else if (bounds.bottom > viewport.bottom) {
            container.scrollTop += bounds.bottom - viewport.bottom;
          }
        }
        setPendingScroll(undefined);
      });
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div
        ref={setScrollRoot}
        class="scrollbar-hidden relative min-h-0 flex-1 overflow-y-auto px-(--sidebar-gutter) [&:has([data-resizing])]:[overflow-anchor:none]"
        on:scroll={{ capture: true, handleEvent: updateDropTarget }}
      >
        <div ref={setStackContent}>
          <ChannelRailVirtualizer
            ref={setStackVirtualizer}
            scrollRoot={scrollRoot()}
            keys={keys()}
            estimateSize={200}
            keepMounted={keepSections()}
            overscan={3}
          >
            {(key) => (
              <Show when={sections().get(key)}>
                {(section) => (
                  <BrowseSection
                    sectionKey={key}
                    section={section()}
                    maxHeight={maximumHeight(key)}
                    outerScrollRoot={scrollRoot()}
                    layoutVersion={stackSize.height ?? 0}
                    sectionOrder={keys()}
                    scrollVersion={scrollVersion()}
                    savedScrollTop={scrollOffsets.get(key) ?? 0}
                    onReady={ready}
                    onPointerDown={() => setGestureSection(key)}
                    favoriteReorder={favoriteReorder}
                    sectionReorder={sectionReorder}
                    register={register}
                  />
                )}
              </Show>
            )}
          </ChannelRailVirtualizer>
        </div>
      </div>
    </div>
  );
}

function ExpandedSearchResults(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  let virtualizer: ChannelRailVirtualizerHandle | undefined;
  let unregister: (() => void) | undefined;

  onCleanup(() => unregister?.());

  const channelsById = createMemo(
    () =>
      new Map(props.search.results().map((channel) => [channel.id, channel]))
  );

  const keepMounted = () => {
    const row = rail.list.focus.item();
    if (row?.kind !== 'conversation') return [];

    const index = props.search
      .results()
      .findIndex(({ id }) => id === row.channel.id);
    return index >= 0 ? [index] : [];
  };

  const loadMoreNearEnd = () => {
    const metrics = virtualizer?.scrollMetrics();
    const source = rail.sources.search;

    if (
      metrics &&
      metrics.size - metrics.offset - metrics.viewport < 300 &&
      source.hasMore() &&
      !source.isFetching() &&
      !source.error()
    ) {
      fireAndForget(source.loadMore(), 'channels-view');
    }
  };

  createScrollTopFade(scrollRoot);

  return (
    <div
      ref={setScrollRoot}
      class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-gutter)"
    >
      <Show
        when={props.search.isLoading() && props.search.results().length === 0}
      >
        <RailListLoading />
      </Show>
      <Show when={props.search.error()}>
        <RailListError retry={props.search.retry} />
      </Show>
      <ChannelRailVirtualizer
        ref={(current) => {
          unregister?.();
          unregister = undefined;
          virtualizer = current;
          if (current) unregister = rail.registerVirtualizer('search', current);
        }}
        keys={[...channelsById().keys()]}
        scrollRoot={scrollRoot()}
        estimateSize={CHANNEL_SECTION_ROW_HEIGHT}
        keepMounted={keepMounted()}
        onRangeChange={loadMoreNearEnd}
      >
        {(id) => (
          <Show when={channelsById().get(id)}>
            {(channel) => <ChannelOption channel={channel()} />}
          </Show>
        )}
      </ChannelRailVirtualizer>
      <Show
        when={
          !props.search.isLoading() &&
          !props.search.error() &&
          props.search.results().length === 0
        }
      >
        <p class="px-2 py-6 text-center text-sm text-ink-muted">
          {t('channelSections.noResults')}
        </p>
      </Show>
    </div>
  );
}

export function ExpandedChannelsRail(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const listTarget = tourTarget(CHANNELS_TOUR.list);

  return (
    <>
      <ExpandedHeader search={props.search} />
      <ChannelsLiveCallsSidebar />
      <div
        ref={(element) => {
          rail.registerRootRef(element);
          listTarget(element);
        }}
        role="tree"
        tabIndex={-1}
        aria-label={t('channelSections.conversations')}
        aria-activedescendant={
          rail.list.focus.key()
            ? domIdForRow(rail.railId, rail.list.focus.key()!)
            : undefined
        }
        class="flex min-h-0 flex-1 flex-col outline-none"
      >
        <Show when={props.search.isOpen()} fallback={<ExpandedBrowse />}>
          <ExpandedSearchResults search={props.search} />
        </Show>
      </div>
      <SlackImportSidebar />
    </>
  );
}
