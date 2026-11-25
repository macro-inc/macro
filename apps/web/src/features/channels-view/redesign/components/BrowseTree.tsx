import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ChecksIcon from '@icon/system/regular/checks.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import PushPinIcon from '@icon/system/regular/push-pin.svg';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Button, cn, Dropdown, Input, SingleSelectCheck, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { SectionSortMode } from '../context/sidebar-workspace-context';
import { useSidebarWorkspace } from '../context/sidebar-workspace-context';
import type { PlacedSection } from '../core/deduplicate-placement';
import type {
  DmFilter,
  DmWindowLimit,
  SidebarChannel,
} from '../core/sidebar-model';
import { SidebarRow } from './SidebarRow';

export type BrowseTreeProps = {
  focusedKey?: string;
  onRegisterScrollRoot?: (el: HTMLDivElement) => void;
};

function SectionHeaderButton(props: {
  id: string;
  title: string;
  open: boolean;
  focused?: boolean;
  unreadCount?: number;
  icon?: JSX.Element;
  badge?: JSX.Element;
  trailing?: JSX.Element;
  onToggle: () => void;
}) {
  return (
    <div
      id={props.id}
      data-section-heading=""
      role="treeitem"
      aria-expanded={props.open}
      tabIndex={-1}
      class={cn(
        'group/sec-head flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink',
        props.focused && 'bg-hover text-ink'
      )}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
        onClick={props.onToggle}
      >
        <Show
          when={props.open}
          fallback={
            <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
          }
        >
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Show>
        {props.icon}
        <span class="min-w-0 truncate">{props.title}</span>
        {props.badge}
        <Show when={(props.unreadCount ?? 0) > 0 && !props.open}>
          <span class="ml-auto shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-accent">
            {props.unreadCount}
          </span>
        </Show>
      </button>
      <Show when={props.trailing}>
        <div
          class="hidden shrink-0 items-center gap-0.5 group-hover/sec-head:flex group-focus-within/sec-head:flex"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {props.trailing}
        </div>
      </Show>
    </div>
  );
}

function CustomSectionMenu(props: { placed: PlacedSection }) {
  const ws = useSidebarWorkspace();
  const section = () => props.placed.section;
  const currentSort = () =>
    ws.sectionSort(section().id) ??
    (props.placed.allChannels.length > 8 ? 'smart' : 'name');

  const sortOptions: { value: SectionSortMode; label: string }[] = [
    { value: 'smart', label: 'Smart (unread & recent)' },
    { value: 'name', label: t('channelSections.alphabetical') },
    { value: 'updated_at', label: t('channelSections.lastUpdated') },
    { value: 'viewed_at', label: t('channelSections.lastViewed') },
    { value: 'created_at', label: t('channelSections.dateCreated') },
  ];

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        as="button"
        aria-label={t('channelSections.optionsFor', { name: section().name })}
        class="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <SlidersIcon class="size-3" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-52">
        <Dropdown.Group>
          <Show when={!section().ruleContains}>
            <Dropdown.Item
              onSelect={() =>
                fireAndForget(
                  ws.addChannelsToSection(section().id),
                  'channels-view'
                )
              }
            >
              <PlusIcon class="size-3.5 shrink-0 text-ink-muted" />
              {t('channelSections.addChannels')}
            </Dropdown.Item>
          </Show>
          <Dropdown.Item
            onSelect={() =>
              fireAndForget(ws.editSection(section().id), 'channels-view')
            }
          >
            <PencilIcon class="size-3.5 shrink-0 text-ink-muted" />
            {t('channelSections.editSection')}
          </Dropdown.Item>
        </Dropdown.Group>

        <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
        <Dropdown.Group>
          <For each={sortOptions}>
            {(opt) => (
              <Dropdown.Item
                onSelect={() => ws.setSectionSort(section().id, opt.value)}
              >
                <span class="flex-1">{opt.label}</span>
                <SingleSelectCheck active={currentSort() === opt.value} />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>

        <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() =>
              fireAndForget(ws.markSectionRead(section().id), 'channels-view')
            }
          >
            <ChecksIcon class="size-3.5 shrink-0 text-ink-muted" />
            {t('channelLabels.markAllAsRead')}
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() =>
              fireAndForget(ws.muteSection(section().id, true), 'channels-view')
            }
          >
            <BellSlashIcon class="size-3.5 shrink-0 text-ink-muted" />
            {t('channelSections.muteAllChannels')}
          </Dropdown.Item>
          <Show when={section().scope === 'team'}>
            <Dropdown.Item
              onSelect={() => ws.prefs.hideTeamSection(section().id)}
            >
              <EyeSlashIcon class="size-3.5 shrink-0 text-ink-muted" />
              <span class="flex flex-col">
                <span>{t('channelSidebar.hideSectionForMe')}</span>
              </span>
            </Dropdown.Item>
          </Show>
        </Dropdown.Group>

        <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
        <Dropdown.Group>
          <Dropdown.Item
            class="text-failure-ink"
            onSelect={() =>
              fireAndForget(ws.deleteSection(section().id), 'channels-view')
            }
          >
            <TrashIcon class="size-3.5 shrink-0" />
            {section().scope === 'team'
              ? t('channelSections.deleteForEveryone')
              : t('channelSections.deleteSection')}
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function PlacedSectionBlock(props: {
  placed: PlacedSection;
  focusedKey?: string;
}) {
  const ws = useSidebarWorkspace();
  const dndCtx = useDragDropContext();
  const [dndState] = dndCtx ?? [];
  const section = () => props.placed.section;
  const open = () => ws.isSectionOpen(section().id);
  const expandedLarge = () =>
    ws.prefs.prefs.expandedLargeSectionIds.includes(section().id);

  const channelScope = `${ws.railId}:redesign-channels`;
  const sectionReorderScope = `${ws.railId}:redesign-section-order:${section().scope}`;

  const droppable = dndCtx
    ? createDroppable(`${channelScope}:section:${section().id}`, {
        dragType: 'redesign-channel-target',
        dndScope: channelScope,
        sectionId: section().id,
        isSmart: Boolean(section().ruleContains),
        scope: section().scope,
        isDropTargetDisabled: () => Boolean(section().ruleContains),
      })
    : undefined;

  const sectionDraggable = dndCtx
    ? createDraggable(`${sectionReorderScope}:drag:${section().id}`, {
        dragType: 'redesign-section-reorder',
        dndScope: sectionReorderScope,
        sectionId: section().id,
        scope: section().scope,
        name: section().name,
      })
    : undefined;
  const sectionDroppable = dndCtx
    ? createDroppable(`${sectionReorderScope}:drop:${section().id}`, {
        dragType: 'redesign-section-reorder-target',
        dndScope: sectionReorderScope,
        sectionId: section().id,
        scope: section().scope,
      })
    : undefined;

  const isChannelDropActive = () => {
    const drag = dndState?.active.draggable?.data;
    const drop = dndState?.active.droppable?.data;
    return (
      drag?.dragType === 'redesign-channel' &&
      drag?.dndScope === channelScope &&
      drop?.dragType === 'redesign-channel-target' &&
      drop?.sectionId === section().id &&
      !section().ruleContains
    );
  };

  const isSectionReorderTarget = () => {
    const drag = dndState?.active.draggable?.data;
    const drop = dndState?.active.droppable?.data;
    return (
      drag?.dragType === 'redesign-section-reorder' &&
      drag?.dndScope === sectionReorderScope &&
      drag?.sectionId !== section().id &&
      drop?.dragType === 'redesign-section-reorder-target' &&
      drop?.sectionId === section().id
    );
  };

  const supportWaitingCount = () =>
    props.placed.isSupport ? ws.supportDesk().needsReplyCount : 0;

  return (
    <div
      ref={(el) => {
        droppable?.ref(el);
        sectionDroppable?.ref(el);
      }}
      data-placed-section={section().id}
      data-section-scope={section().scope}
      class={cn(
        'flex flex-col gap-0.5 rounded-lg transition-colors',
        isChannelDropActive() && 'bg-selected ring-1 ring-inset ring-accent',
        isSectionReorderTarget() && 'border-t-2 border-accent',
        sectionDraggable?.isActiveDraggable && 'opacity-50'
      )}
    >
      <div
        ref={(el) => sectionDraggable?.ref(el)}
        {...(sectionDraggable ? sectionDraggable.dragActivators : {})}
      >
        <SectionHeaderButton
          id={`${ws.railId}-section:${section().id}`}
          title={section().name}
          open={open()}
          focused={props.focusedKey === `section:${section().id}`}
          unreadCount={props.placed.unreadCount}
          onToggle={() => ws.setSectionOpen(section().id, !open())}
          badge={
            <span class="flex shrink-0 items-center gap-1">
              <Show when={section().ruleContains}>
                <Tooltip
                  as="span"
                  label={t('channelLabels.nameContains', {
                    text: section().ruleContains ?? '',
                  })}
                >
                  <FunnelIcon class="size-3 text-ink-extra-muted" />
                </Tooltip>
              </Show>
              <Show when={supportWaitingCount() > 0}>
                <Tooltip label={t('channelSidebar.openSupportDesk')}>
                  <button
                    type="button"
                    data-open-support-desk-pill=""
                    class="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-warning hover:bg-warning/25"
                    onClick={(event) => {
                      event.stopPropagation();
                      ws.prefs.setActiveLens('support');
                    }}
                  >
                    {t('channelSidebar.supportWaitingSummary', {
                      count: supportWaitingCount(),
                    })}
                  </button>
                </Tooltip>
              </Show>
            </span>
          }
          trailing={<CustomSectionMenu placed={props.placed} />}
        />
      </div>

      <Show when={open()}>
        <div class="flex flex-col gap-0.5 pl-1.5">
          <Show
            when={props.placed.visibleChannels.length > 0}
            fallback={
              <p class="px-2 py-1 text-xs text-ink-extra-muted">
                {ws.prefs.prefs.unreadOnly
                  ? t('channelSections.noUnreadConversations')
                  : section().ruleContains
                    ? t('channelSections.emptySmartSection')
                    : t('channelSections.emptySection')}
              </p>
            }
          >
            <For each={props.placed.visibleChannels}>
              {(entry) => (
                <SidebarRow
                  channel={entry.channel}
                  displayName={entry.displayName}
                  rowId={`ch:${entry.channel.id}`}
                  focused={props.focusedKey === `ch:${entry.channel.id}`}
                  drag={
                    !section().ruleContains
                      ? {
                          kind: 'channel',
                          channelId: entry.channel.id,
                          fromSectionId: section().id,
                        }
                      : undefined
                  }
                />
              )}
            </For>
          </Show>

          <Show when={props.placed.overflowCount > 0}>
            <button
              type="button"
              data-section-show-more={section().id}
              class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => ws.prefs.toggleLargeSectionExpanded(section().id)}
            >
              <span>
                {t('channelSidebar.sectionShowMore', {
                  count: props.placed.overflowCount,
                })}
              </span>
            </button>
          </Show>

          <Show
            when={
              expandedLarge() &&
              props.placed.allChannels.length > 8 &&
              props.placed.overflowCount === 0
            }
          >
            <button
              type="button"
              data-section-show-less={section().id}
              class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => ws.prefs.toggleLargeSectionExpanded(section().id)}
            >
              <span>{t('channelSidebar.sectionShowLess')}</span>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function DirectMessagesSection(props: { focusedKey?: string }) {
  const ws = useSidebarWorkspace();
  const [filterInputOpen, setFilterInputOpen] = createSignal(false);
  let dmSearchRef: HTMLInputElement | undefined;

  const open = () => ws.isGroupOpen('direct_messages');
  const dmWindow = () => ws.dmWindow();
  const totalUnreadDms = () =>
    dmWindow().unreadPeopleCount + dmWindow().unreadAgentCount;
  const activeFilter = () => ws.prefs.prefs.dmFilter;

  const dmLimitOptions: { value: DmWindowLimit; label: string }[] = [
    { value: 5, label: t('channelSidebar.dmWindowOption', { count: 5 }) },
    { value: 7, label: t('channelSidebar.dmWindowOption', { count: 7 }) },
    { value: 12, label: t('channelSidebar.dmWindowOption', { count: 12 }) },
    { value: 'all', label: t('channelSidebar.dmWindowAll') },
  ];

  const filterTabs: { id: DmFilter; label: string; count: () => number }[] = [
    {
      id: 'all',
      label: t('channelSidebar.dmFilterAll'),
      count: () => dmWindow().peopleCount + dmWindow().agentCount,
    },
    {
      id: 'people',
      label: t('channelSidebar.dmFilterPeople'),
      count: () => dmWindow().peopleCount,
    },
    {
      id: 'agents',
      label: t('channelSidebar.dmFilterAgents'),
      count: () => dmWindow().agentCount,
    },
  ];

  const dmChannelIds = () =>
    ws
      .channels()
      .filter((ch) => ch.channelType === 'direct_message' && ch.isParticipant)
      .map((ch) => ch.id);

  return (
    <section
      class="flex flex-col gap-1"
      data-dm-section=""
      aria-label={t('channelSidebar.dmHeading')}
    >
      <SectionHeaderButton
        id={`${ws.railId}-group:direct_messages`}
        title={t('channelSidebar.dmHeading')}
        open={open()}
        focused={props.focusedKey === 'group:direct_messages'}
        unreadCount={totalUnreadDms()}
        onToggle={() => ws.setGroupOpen('direct_messages', !open())}
        trailing={
          <>
            <Tooltip label={t('channelSidebar.dmFilterPlaceholder')}>
              <button
                type="button"
                aria-label={t('channelSidebar.dmFilterPlaceholder')}
                class={cn(
                  'flex size-5 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink',
                  filterInputOpen() && 'bg-surface-2 text-ink'
                )}
                onClick={() => {
                  const next = !filterInputOpen();
                  setFilterInputOpen(next);
                  if (next) {
                    ws.setGroupOpen('direct_messages', true);
                    queueMicrotask(() => dmSearchRef?.focus());
                  } else {
                    ws.setDmQuery('');
                  }
                }}
              >
                <SearchIcon class="size-3" />
              </button>
            </Tooltip>
            <Tooltip label={t('channelSections.newDirectMessage')}>
              <button
                type="button"
                aria-label={t('channelSections.newDirectMessage')}
                class="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink"
                onClick={() => ws.openCreateDm()}
              >
                <PlusIcon class="size-3" />
              </button>
            </Tooltip>
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                as="button"
                aria-label={t('channelSections.optionsFor', {
                  name: t('channelSidebar.dmHeading'),
                })}
                class="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <SlidersIcon class="size-3" />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-48">
                <div class="px-2 py-1 text-[11px] font-medium text-ink-extra-muted">
                  {t('channelSidebar.dmWindowSize')}
                </div>
                <Dropdown.Group>
                  <For each={dmLimitOptions}>
                    {(opt) => (
                      <Dropdown.Item
                        onSelect={() => ws.prefs.setDmWindowLimit(opt.value)}
                      >
                        <span class="flex-1">{opt.label}</span>
                        <SingleSelectCheck
                          active={ws.prefs.prefs.dmWindowLimit === opt.value}
                        />
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Group>
                <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
                <Dropdown.Group>
                  <Dropdown.Item
                    onSelect={() =>
                      fireAndForget(
                        ws.markChannelsRead(dmChannelIds()),
                        'channels-view'
                      )
                    }
                  >
                    <ChecksIcon class="size-3.5 shrink-0 text-ink-muted" />
                    {t('channelLabels.markAllAsRead')}
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </>
        }
      />

      <Show when={open()}>
        <div class="flex flex-col gap-1 pl-1.5">
          {/* Compact All / People / Agents segmented micro-filter */}
          <div
            class="flex items-center gap-1 px-1"
            role="tablist"
            aria-label="Direct messages filter"
            data-dm-filter-tabs=""
          >
            <For each={filterTabs}>
              {(tab) => {
                const isSelected = () => activeFilter() === tab.id;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isSelected()}
                    data-dm-filter={tab.id}
                    class={cn(
                      'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
                      isSelected()
                        ? 'bg-surface-2 text-ink'
                        : 'text-ink-extra-muted hover:bg-hover hover:text-ink-muted'
                    )}
                    onClick={() => ws.prefs.setDmFilter(tab.id)}
                  >
                    <span>{tab.label}</span>
                    <Show when={tab.id === 'agents' && tab.count() > 0}>
                      <span class="tabular-nums opacity-75">{tab.count()}</span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>

          {/* Optional inline DM filter input */}
          <Show when={filterInputOpen() || ws.dmQuery().length > 0}>
            <div class="relative px-1">
              <Input
                ref={dmSearchRef}
                type="text"
                value={ws.dmQuery()}
                onInput={(event) => ws.setDmQuery(event.currentTarget.value)}
                placeholder={t('channelSidebar.dmFilterPlaceholder')}
                aria-label={t('channelSidebar.dmFilterPlaceholder')}
                class="h-7 w-full pr-6 text-xs"
              />
              <Show when={ws.dmQuery().length > 0}>
                <button
                  type="button"
                  aria-label="Clear DM filter"
                  class="absolute top-1.5 right-2.5 flex size-4 items-center justify-center text-ink-extra-muted hover:text-ink"
                  onClick={() => ws.setDmQuery('')}
                >
                  <XIcon class="size-3" />
                </button>
              </Show>
            </div>
          </Show>

          {/* Bounded DM rows */}
          <Show
            when={dmWindow().visible.length > 0}
            fallback={
              <p class="px-2 py-1 text-xs text-ink-extra-muted">
                {activeFilter() === 'agents'
                  ? t('channelSidebar.dmEmptyAgents')
                  : ws.prefs.prefs.unreadOnly
                    ? t('channelSections.noUnreadConversations')
                    : t('channelSidebar.dmEmptyPeople')}
              </p>
            }
          >
            <div class="flex flex-col gap-0.5">
              <For each={dmWindow().visible}>
                {(dm) => (
                  <SidebarRow
                    channel={dm}
                    rowId={`dm:${dm.id}`}
                    focused={props.focusedKey === `dm:${dm.id}`}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Smart window overflow toggle */}
          <Show when={dmWindow().overflowCount > 0}>
            <button
              type="button"
              data-dm-show-more=""
              class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => ws.prefs.setDmExpandedAll(true)}
            >
              <span>
                {t('channelSidebar.dmShowMore', {
                  count: dmWindow().overflowCount,
                })}
              </span>
            </button>
          </Show>

          <Show
            when={
              ws.prefs.prefs.dmExpandedAll &&
              ws.prefs.prefs.dmWindowLimit !== 'all' &&
              dmWindow().totalFilteredCount >
                (typeof ws.prefs.prefs.dmWindowLimit === 'number'
                  ? ws.prefs.prefs.dmWindowLimit
                  : 0)
            }
          >
            <button
              type="button"
              data-dm-show-less=""
              class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => ws.prefs.setDmExpandedAll(false)}
            >
              <span>{t('channelSidebar.dmShowLess')}</span>
            </button>
          </Show>
        </div>
      </Show>
    </section>
  );
}

export function BrowseTree(props: BrowseTreeProps) {
  const ws = useSidebarWorkspace();
  const dndCtx = useDragDropContext();
  const [dndState] = dndCtx ?? [];
  const [hiddenDrawerOpen, setHiddenDrawerOpen] = createSignal(false);

  const placement = () => ws.placement();

  const favoriteChannels = (): SidebarChannel[] =>
    ws
      .favoriteChannelIds()
      .flatMap((id) => {
        const ch = ws.channelById(id);
        return ch ? [ch] : [];
      })
      .filter((ch) => {
        const isUnread = ws.unreadOrMentionedIds().has(ch.id);
        if (ws.prefs.prefs.unreadOnly && !isUnread) return false;
        if (
          ws.prefs.prefs.hideMuted &&
          ws.mutedIds().has(ch.id) &&
          !isUnread &&
          ch.id !== ws.selectedChannelId()
        ) {
          return false;
        }
        return true;
      });

  const favoritesUnread = () =>
    favoriteChannels().filter((ch) => ws.unreadIds().has(ch.id)).length;

  const favoriteDropEdge = (targetId: string): 'top' | 'bottom' | undefined => {
    const drag = dndState?.active.draggable?.data;
    const drop = dndState?.active.droppable?.data;
    const scope = `${ws.railId}:redesign-favorites`;
    if (
      drag?.dndScope !== scope ||
      drop?.dndScope !== scope ||
      drop?.channelId !== targetId ||
      drag?.channelId === targetId
    ) {
      return undefined;
    }
    const ids = favoriteChannels().map((ch) => ch.id);
    const srcIdx = ids.indexOf(String(drag.channelId));
    const dstIdx = ids.indexOf(targetId);
    if (srcIdx < 0 || dstIdx < 0) return undefined;
    return srcIdx < dstIdx ? 'bottom' : 'top';
  };

  // Ungrouped Channels drop zone (dropping a section channel here unfiles it)
  const channelScope = `${ws.railId}:redesign-channels`;
  const ungroupedDroppable = dndCtx
    ? createDroppable(`${channelScope}:ungrouped`, {
        dragType: 'redesign-channel-target',
        dndScope: channelScope,
        sectionId: undefined,
        isSmart: false,
        scope: 'ungrouped',
      })
    : undefined;
  const isUngroupedDropActive = () => {
    const drag = dndState?.active.draggable?.data;
    const drop = dndState?.active.droppable?.data;
    return (
      drag?.dragType === 'redesign-channel' &&
      drag?.dndScope === channelScope &&
      Boolean(drag?.fromSectionId) &&
      drop?.dragType === 'redesign-channel-target' &&
      drop?.scope === 'ungrouped'
    );
  };

  const ungroupedUnread = () =>
    placement().ungroupedChannels.filter((ch) => ws.unreadIds().has(ch.id))
      .length;

  const teamLabel = () => {
    const name = ws.teamName();
    return name
      ? t('channelSidebar.teamZone', { name })
      : t('channelSidebar.teamZoneFallback');
  };

  return (
    <div
      ref={props.onRegisterScrollRoot}
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-2"
      data-sidebar-lens-panel="browse"
      data-browse-scroll-root=""
    >
      {/* Loading skeleton */}
      <Show when={ws.isLoading() && ws.channels().length === 0}>
        <div
          class="flex flex-col gap-2 px-1 py-2"
          data-sidebar-loading=""
          aria-busy="true"
        >
          <For each={[1, 2, 3, 4, 5, 6]}>
            {() => (
              <div class="h-7 w-full animate-pulse rounded-lg bg-surface-2/70" />
            )}
          </For>
        </div>
      </Show>

      {/* Error banner */}
      <Show when={Boolean(ws.error()) && ws.channels().length === 0}>
        <div class="flex flex-col items-center gap-2 rounded-lg border border-edge-muted px-3 py-6 text-center">
          <p class="text-xs text-ink-muted">
            {t('channelSections.channelsUnavailable')}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={ws.retry}
          >
            {t('channelSections.retry')}
          </Button>
        </div>
      </Show>

      {/* Sections API error banner (non-blocking) */}
      <Show when={ws.labelsFailed()}>
        <div
          class="flex items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-xs text-ink-muted"
          role="status"
        >
          <span class="min-w-0 flex-1 truncate">
            {ws.labelsUnavailableReason()}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={ws.retryLabels}
          >
            {t('channelSections.retry')}
          </Button>
        </div>
      </Show>

      <Show when={!ws.isLoading() || ws.channels().length > 0}>
        {/* 1. Pinned (Favorites) */}
        <Show when={favoriteChannels().length > 0}>
          <section
            class="flex flex-col gap-0.5"
            data-pinned-section=""
            aria-label={t('channelSidebar.pinnedHeading')}
          >
            <SectionHeaderButton
              id={`${ws.railId}-group:favorites`}
              title={t('channelSidebar.pinnedHeading')}
              open={ws.isGroupOpen('favorites')}
              focused={props.focusedKey === 'group:favorites'}
              unreadCount={favoritesUnread()}
              icon={
                <PushPinIcon class="size-3 shrink-0 text-ink-extra-muted" />
              }
              onToggle={() =>
                ws.setGroupOpen('favorites', !ws.isGroupOpen('favorites'))
              }
            />
            <Show when={ws.isGroupOpen('favorites')}>
              <div class="flex flex-col gap-0.5 pl-1.5">
                <For each={favoriteChannels()}>
                  {(channel) => (
                    <SidebarRow
                      channel={channel}
                      rowId={`fav:${channel.id}`}
                      focused={props.focusedKey === `fav:${channel.id}`}
                      drag={{ kind: 'favorite', channelId: channel.id }}
                      dropEdge={favoriteDropEdge(channel.id)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </section>
        </Show>

        {/* 2. Direct messages smart window */}
        <DirectMessagesSection focusedKey={props.focusedKey} />

        {/* 3. Personal Layer */}
        <section
          class="flex flex-col gap-1 border-t border-edge-muted/70 pt-2.5"
          data-personal-zone=""
          aria-label={t('channelSidebar.personalZone')}
        >
          <div class="flex items-center justify-between px-1.5">
            <button
              type="button"
              class="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-ink-extra-muted uppercase hover:text-ink-muted"
              onClick={() => ws.prefs.togglePersonalZone()}
            >
              <span>{t('channelSidebar.personalZone')}</span>
            </button>
            <Show when={ws.labelsAvailable()}>
              <Tooltip label={t('channelSidebar.newPersonalSection')}>
                <button
                  type="button"
                  aria-label={t('channelSidebar.newPersonalSection')}
                  class="flex size-5 items-center justify-center rounded text-ink-extra-muted hover:bg-hover hover:text-ink"
                  onClick={() =>
                    fireAndForget(
                      ws.createSection({ scope: 'personal' }),
                      'channels-view'
                    )
                  }
                >
                  <PlusIcon class="size-3" />
                </button>
              </Tooltip>
            </Show>
          </div>

          <Show when={!ws.prefs.prefs.collapsedPersonalZone}>
            <Show
              when={placement().personalSections.length > 0}
              fallback={
                <p class="px-2 py-0.5 text-[11px] text-ink-extra-muted">
                  Group your focus channels privately without changing the team
                  layout.
                </p>
              }
            >
              <div class="flex flex-col gap-1">
                <For each={placement().personalSections}>
                  {(placed) => (
                    <PlacedSectionBlock
                      placed={placed}
                      focusedKey={props.focusedKey}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </section>

        {/* 4. Team Layer */}
        <section
          class="flex flex-col gap-1.5 border-t border-edge-muted/70 pt-2.5"
          data-team-zone=""
          aria-label={teamLabel()}
        >
          <div class="flex items-center justify-between px-1.5">
            <button
              type="button"
              class="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-ink-extra-muted uppercase hover:text-ink-muted"
              onClick={() => ws.prefs.toggleTeamZone()}
            >
              <UsersIcon class="size-3 shrink-0" />
              <span class="truncate">{teamLabel()}</span>
            </button>
            <div class="flex items-center gap-0.5">
              <Show when={ws.canShareSections() && ws.labelsAvailable()}>
                <Tooltip label={t('channelSidebar.newTeamSection')}>
                  <button
                    type="button"
                    aria-label={t('channelSidebar.newTeamSection')}
                    class="flex size-5 items-center justify-center rounded text-ink-extra-muted hover:bg-hover hover:text-ink"
                    onClick={() =>
                      fireAndForget(
                        ws.createSection({ scope: 'team' }),
                        'channels-view'
                      )
                    }
                  >
                    <PlusIcon class="size-3" />
                  </button>
                </Tooltip>
              </Show>
            </div>
          </div>

          <Show when={!ws.prefs.prefs.collapsedTeamZone}>
            {/* Shared team sections (visible, deduplicated against Personal) */}
            <div class="flex flex-col gap-1">
              <For each={placement().teamSections}>
                {(placed) => (
                  <PlacedSectionBlock
                    placed={placed}
                    focusedKey={props.focusedKey}
                  />
                )}
              </For>
            </div>

            {/* Ungrouped Channels ONLY — zero duplication with sections above! */}
            <div
              ref={(el) => ungroupedDroppable?.ref(el)}
              data-ungrouped-section=""
              class={cn(
                'flex flex-col gap-0.5 rounded-lg transition-colors',
                isUngroupedDropActive() &&
                  'bg-selected ring-1 ring-inset ring-accent'
              )}
            >
              <SectionHeaderButton
                id={`${ws.railId}-group:channels`}
                title={t('channelSidebar.ungroupedChannels')}
                open={ws.isGroupOpen('channels')}
                focused={props.focusedKey === 'group:channels'}
                unreadCount={ungroupedUnread()}
                onToggle={() =>
                  ws.setGroupOpen('channels', !ws.isGroupOpen('channels'))
                }
                trailing={
                  <Tooltip label={t('channelSections.newChannel')}>
                    <button
                      type="button"
                      aria-label={t('channelSections.newChannel')}
                      class="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink"
                      onClick={() => ws.openCreateChannel()}
                    >
                      <PlusIcon class="size-3" />
                    </button>
                  </Tooltip>
                }
              />

              <Show when={ws.isGroupOpen('channels')}>
                <div class="flex flex-col gap-0.5 pl-1.5">
                  <Show
                    when={placement().ungroupedChannels.length > 0}
                    fallback={
                      <p class="px-2 py-1 text-xs text-ink-extra-muted">
                        {ws.prefs.prefs.unreadOnly
                          ? t('channelSections.noUnreadConversations')
                          : t('channelSections.empty')}
                      </p>
                    }
                  >
                    <For each={placement().ungroupedChannels}>
                      {(channel) => (
                        <SidebarRow
                          channel={channel}
                          rowId={`ch:${channel.id}`}
                          focused={props.focusedKey === `ch:${channel.id}`}
                          drag={{ kind: 'channel', channelId: channel.id }}
                        />
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Compact restore bar for personally hidden team sections */}
            <Show when={placement().hiddenTeamSections.length > 0}>
              <div
                class="mt-1 flex flex-col gap-1 rounded-lg border border-edge-muted/70 bg-surface-2/40 px-2 py-1.5"
                data-hidden-sections-bar=""
              >
                <div class="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    class="flex min-w-0 items-center gap-1.5 text-left text-[11px] font-medium text-ink-muted hover:text-ink"
                    onClick={() => setHiddenDrawerOpen((prev) => !prev)}
                  >
                    <EyeSlashIcon class="size-3 shrink-0 text-ink-extra-muted" />
                    <span class="truncate">
                      {t('channelSidebar.hiddenSectionsCount', {
                        count: placement().hiddenTeamSections.length,
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="shrink-0 text-[11px] font-medium text-accent hover:underline"
                    onClick={() => ws.prefs.restoreAllHiddenTeamSections()}
                  >
                    {t('channelSidebar.restoreAllHidden')}
                  </button>
                </div>
                <Show when={hiddenDrawerOpen()}>
                  <div class="flex flex-col gap-0.5 pt-1">
                    <For each={placement().hiddenTeamSections}>
                      {(section) => (
                        <div class="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-hover">
                          <span class="min-w-0 truncate">{section.name}</span>
                          <button
                            type="button"
                            class="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                            onClick={() => ws.prefs.showTeamSection(section.id)}
                          >
                            <EyeIcon class="size-3" />
                            <span>{t('channelSidebar.showHiddenSection')}</span>
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </Show>
        </section>
      </Show>
    </div>
  );
}
