import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowClockwiseIcon from '@icon/system/regular/arrow-clockwise.svg';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import ChatCircleDotsIcon from '@icon/system/regular/chat-circle-dots.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import FunnelSimpleIcon from '@icon/system/regular/funnel-simple.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { cn, Dropdown, ToggleSwitch, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { BrowseTree } from '../components/BrowseTree';
import { FocusView } from '../components/FocusView';
import { QuickSwitchModal } from '../components/QuickSwitchModal';
import { SidebarRow } from '../components/SidebarRow';
import { SmartOrganizeDialog } from '../components/SmartOrganizeDialog';
import { SupportDeskView } from '../components/SupportDeskView';
import {
  type SidebarBuiltInGroup,
  useSidebarWorkspace,
} from '../context/sidebar-workspace-context';
import type { SidebarLens } from '../core/sidebar-model';

type FlatNavItem =
  | { key: string; kind: 'group'; group: SidebarBuiltInGroup }
  | { key: string; kind: 'section'; sectionId: string }
  | { key: string; kind: 'channel'; channelId: string };

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isInteractiveControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.matches('[data-channel-sidebar-redesign]')) return false;
  return Boolean(
    target.closest(
      'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], summary'
    )
  );
}

export function ChannelSidebarWorkspace() {
  const ws = useSidebarWorkspace();
  const [, dndActions] = useDragDropContext() ?? [];
  const [quickSwitchOpen, setQuickSwitchOpen] = createSignal(false);
  const [organizeOpen, setOrganizeOpen] = createSignal(false);
  const [focusedKey, setFocusedKey] = createSignal<string>();
  let rootRef: HTMLDivElement | undefined;
  let browseScrollRoot: HTMLDivElement | undefined;

  const activeLens = (): SidebarLens => {
    if (ws.activeTab() === 'threads') return 'threads';
    const pref = ws.prefs.prefs.activeLens;
    if (pref === 'threads') return 'browse';
    if (pref === 'support' && ws.supportDesk().items.length === 0) {
      return 'browse';
    }
    return pref;
  };

  const selectLens = (lens: SidebarLens) => {
    if (lens === 'threads') {
      ws.openThreads();
      return;
    }
    if (ws.activeTab() === 'threads') ws.exitThreads();
    ws.prefs.setActiveLens(lens);
  };

  // Drag-and-drop end handler for channel section moves, favorite reorder, and section reorder.
  if (dndActions) {
    const channelScope = `${ws.railId}:redesign-channels`;
    const favScope = `${ws.railId}:redesign-favorites`;

    dndActions.onDragEnd(({ draggable, droppable }) => {
      if (!droppable) return;
      const drag = draggable.data;
      const drop = droppable.data;

      if (
        drag?.dragType === 'redesign-favorite' &&
        drag?.dndScope === favScope &&
        drop?.dragType === 'redesign-favorite-target' &&
        drop?.dndScope === favScope &&
        typeof drag.channelId === 'string' &&
        typeof drop.channelId === 'string' &&
        drag.channelId !== drop.channelId
      ) {
        fireAndForget(
          ws.reorderFavorites(drag.channelId, drop.channelId),
          'channels-view'
        );
        return;
      }

      if (
        drag?.dragType === 'redesign-channel' &&
        drag?.dndScope === channelScope &&
        drop?.dragType === 'redesign-channel-target' &&
        drop?.dndScope === channelScope &&
        typeof drag.channelId === 'string'
      ) {
        if (drop.isSmart) return;
        // Personal placement wins over team placement; block personal-to-team drops
        // so users are never surprised by a row staying in its personal section.
        if (drag.fromSectionScope === 'personal' && drop.scope === 'team') {
          return;
        }
        const targetSectionId =
          typeof drop.sectionId === 'string' ? drop.sectionId : undefined;
        const fromSectionId =
          typeof drag.fromSectionId === 'string'
            ? drag.fromSectionId
            : undefined;
        if (targetSectionId === fromSectionId) return;
        fireAndForget(
          ws.assignChannelToSection(
            drag.channelId,
            targetSectionId,
            fromSectionId
          ),
          'channels-view'
        );
        return;
      }

      if (
        drag?.dragType === 'redesign-section-reorder' &&
        drop?.dragType === 'redesign-section-reorder-target' &&
        drag?.dndScope === drop?.dndScope &&
        typeof drag.sectionId === 'string' &&
        typeof drop.sectionId === 'string' &&
        drag.sectionId !== drop.sectionId
      ) {
        const scope = drag.scope === 'team' ? 'team' : 'personal';
        const placedList =
          scope === 'team'
            ? ws.placement().teamSections
            : ws.placement().personalSections;
        const ids = placedList.map((p) => p.section.id);
        const srcIdx = ids.indexOf(drag.sectionId);
        const dstIdx = ids.indexOf(drop.sectionId);
        if (srcIdx < 0 || dstIdx < 0) return;
        const reordered = [...ids];
        reordered.splice(dstIdx, 0, ...reordered.splice(srcIdx, 1));
        const otherScopeIds = (
          scope === 'team'
            ? ws.placement().personalSections
            : ws.placement().teamSections
        ).map((p) => p.section.id);
        ws.setSectionOrder(
          scope === 'personal'
            ? [...reordered, ...otherScopeIds]
            : [...otherScopeIds, ...reordered]
        );
      }
    });
  }

  // Flat navigable row order for keyboard navigation across the active lens.
  const navItems = createMemo<FlatNavItem[]>(() => {
    const lens = activeLens();
    if (lens === 'focus') {
      const m = ws.focusModel();
      const rows = [
        ...m.direct,
        ...m.support,
        ...m.unread,
        ...(ws.prefs.prefs.collapsedFocusFyi ? [] : m.fyi),
      ];
      return rows.map((item) => ({
        key: `focus:${item.channel.id}`,
        kind: 'channel',
        channelId: item.channel.id,
      }));
    }

    if (lens === 'support') {
      const desk = ws.supportDesk();
      const collapsed = new Set(ws.prefs.prefs.collapsedSupportBuckets);
      const rows = [
        ...(collapsed.has('needs_reply') ? [] : desk.needsReplyGroup),
        ...(collapsed.has('agent_handling') ? [] : desk.byState.agent_handling),
        ...(collapsed.has('waiting_on_customer')
          ? []
          : desk.byState.waiting_on_customer),
        ...(collapsed.has('resolved') ? [] : desk.byState.resolved),
      ];
      return rows.map((item) => ({
        key: `support:${item.channel.id}`,
        kind: 'channel',
        channelId: item.channel.id,
      }));
    }

    if (lens === 'threads') {
      return ws
        .channels()
        .filter((ch) => ch.isParticipant)
        .slice(0, 80)
        .map((ch) => ({
          key: `thread:${ch.id}`,
          kind: 'channel',
          channelId: ch.id,
        }));
    }

    // Browse tree
    const items: FlatNavItem[] = [];
    const favs = ws.favoriteChannelIds().filter((id) => ws.channelById(id));
    if (favs.length > 0) {
      items.push({ key: 'group:favorites', kind: 'group', group: 'favorites' });
      if (ws.isGroupOpen('favorites')) {
        for (const id of favs) {
          items.push({ key: `fav:${id}`, kind: 'channel', channelId: id });
        }
      }
    }

    items.push({
      key: 'group:direct_messages',
      kind: 'group',
      group: 'direct_messages',
    });
    if (ws.isGroupOpen('direct_messages')) {
      for (const dm of ws.dmWindow().visible) {
        items.push({ key: `dm:${dm.id}`, kind: 'channel', channelId: dm.id });
      }
    }

    const p = ws.placement();
    if (!ws.prefs.prefs.collapsedPersonalZone) {
      for (const sec of p.personalSections) {
        items.push({
          key: `section:${sec.section.id}`,
          kind: 'section',
          sectionId: sec.section.id,
        });
        if (ws.isSectionOpen(sec.section.id)) {
          for (const entry of sec.visibleChannels) {
            items.push({
              key: `ch:${entry.channel.id}`,
              kind: 'channel',
              channelId: entry.channel.id,
            });
          }
        }
      }
    }

    if (!ws.prefs.prefs.collapsedTeamZone) {
      for (const sec of p.teamSections) {
        items.push({
          key: `section:${sec.section.id}`,
          kind: 'section',
          sectionId: sec.section.id,
        });
        if (ws.isSectionOpen(sec.section.id)) {
          for (const entry of sec.visibleChannels) {
            items.push({
              key: `ch:${entry.channel.id}`,
              kind: 'channel',
              channelId: entry.channel.id,
            });
          }
        }
      }

      items.push({ key: 'group:channels', kind: 'group', group: 'channels' });
      if (ws.isGroupOpen('channels')) {
        for (const ch of p.ungroupedChannels) {
          items.push({ key: `ch:${ch.id}`, kind: 'channel', channelId: ch.id });
        }
      }
    }

    return items;
  });

  const scrollFocusedIntoView = (key: string) => {
    const el = document.getElementById(`${ws.railId}-${key}`);
    el?.scrollIntoView({ block: 'nearest' });
  };

  const moveFocus = (delta: 1 | -1) => {
    const items = navItems();
    if (items.length === 0) return;
    const currentIdx = items.findIndex((item) => item.key === focusedKey());
    const nextIdx =
      currentIdx < 0
        ? delta === 1
          ? 0
          : items.length - 1
        : (currentIdx + delta + items.length) % items.length;
    const target = items[nextIdx];
    if (!target) return;
    setFocusedKey(target.key);
    scrollFocusedIntoView(target.key);
  };

  const jumpSection = (delta: 1 | -1) => {
    const headers = navItems().filter(
      (item) => item.kind === 'group' || item.kind === 'section'
    );
    if (headers.length === 0) return;
    const currentIdx = headers.findIndex((item) => item.key === focusedKey());
    const nextIdx =
      currentIdx < 0
        ? delta === 1
          ? 0
          : headers.length - 1
        : (currentIdx + delta + headers.length) % headers.length;
    const target = headers[nextIdx];
    if (!target) return;
    setFocusedKey(target.key);
    scrollFocusedIntoView(target.key);
  };

  const toggleFocusedDisclosure = (expand: boolean) => {
    const current = navItems().find((item) => item.key === focusedKey());
    if (!current) return;
    if (current.kind === 'group') {
      ws.setGroupOpen(current.group, expand);
    } else if (current.kind === 'section') {
      ws.setSectionOpen(current.sectionId, expand);
    }
  };

  const activateFocused = (newSplit: boolean) => {
    const current = navItems().find((item) => item.key === focusedKey());
    if (!current) return;
    if (current.kind === 'group') {
      ws.setGroupOpen(current.group, !ws.isGroupOpen(current.group));
      return;
    }
    if (current.kind === 'section') {
      ws.setSectionOpen(
        current.sectionId,
        !ws.isSectionOpen(current.sectionId)
      );
      return;
    }
    if (activeLens() === 'threads' && !newSplit) {
      ws.setThreadsChannelId(current.channelId);
      return;
    }
    ws.openChannel(current.channelId, { newSplit, focusComposer: true });
  };

  // Global sidebar shortcuts (Cmd+J, Cmd+Shift+U) + focused sidebar navigation
  createEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setQuickSwitchOpen(true);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        ws.prefs.toggleUnreadOnly();
        return;
      }
      if (
        mod &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f' &&
        rootRef?.contains(document.activeElement)
      ) {
        event.preventDefault();
        setQuickSwitchOpen(true);
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onGlobalKeyDown));
  });

  const handleTreeKeyDown = (event: KeyboardEvent) => {
    if (isEditableElement(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isInteractiveControl(event.target)) return;

    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
      case 'k':
        event.preventDefault();
        moveFocus(-1);
        break;
      case ']':
        if (activeLens() === 'browse') {
          event.preventDefault();
          jumpSection(1);
        }
        break;
      case '[':
        if (activeLens() === 'browse') {
          event.preventDefault();
          jumpSection(-1);
        }
        break;
      case 'ArrowRight':
      case 'l':
        event.preventDefault();
        toggleFocusedDisclosure(true);
        break;
      case 'ArrowLeft':
      case 'h':
        event.preventDefault();
        toggleFocusedDisclosure(false);
        break;
      case 'Enter':
        event.preventDefault();
        activateFocused(event.shiftKey);
        break;
      case '1':
        event.preventDefault();
        selectLens('browse');
        break;
      case '2':
        event.preventDefault();
        selectLens('focus');
        break;
      case '3':
        if (ws.supportDesk().items.length > 0) {
          event.preventDefault();
          selectLens('support');
        }
        break;
      case '4':
        if (ws.threadsEnabled()) {
          event.preventDefault();
          selectLens('threads');
        }
        break;
    }
  };

  const hasSupport = () => ws.supportDesk().items.length > 0;
  const focusCount = () => ws.focusModel().actionableCount;
  const supportWaiting = () => ws.supportDesk().needsReplyCount;

  const engineLabel = () => {
    const status = ws.triage.engineStatus();
    if (status === 'jev') return t('channelSidebar.jevEngineActive');
    if (status === 'paused') return t('channelSidebar.jevEnginePaused');
    return t('channelSidebar.jevEngineHeuristic');
  };

  return (
    <ViewSidebar.Root
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
      data-channel-sidebar-redesign=""
      class="overflow-hidden outline-none"
    >
      {/* Top Header — uses ViewSidebar.Title so view switcher stays native */}
      <div class="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <div class="flex min-w-0 items-center gap-1">
          {ws.renderHeaderCloseButton?.()}
          <ViewSidebar.Title>{t('channelSections.chat')}</ViewSidebar.Title>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          {/* Global Unread-only filter pill */}
          <Tooltip label={t('channelSidebar.unreadOnlyTooltip')}>
            <button
              type="button"
              data-unread-only-toggle=""
              aria-pressed={ws.prefs.prefs.unreadOnly}
              aria-label={t('channelSidebar.unreadOnlyActive')}
              class={cn(
                'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
                ws.prefs.prefs.unreadOnly
                  ? 'bg-accent/15 text-accent'
                  : 'text-ink-muted hover:bg-hover hover:text-ink'
              )}
              onClick={() => ws.prefs.toggleUnreadOnly()}
            >
              <FunnelSimpleIcon class="size-3.5 shrink-0" />
              <Show when={ws.totalUnreadCount() > 0}>
                <span class="tabular-nums">{ws.totalUnreadCount()}</span>
              </Show>
            </button>
          </Tooltip>

          {/* Quick Switch trigger (Cmd+J) */}
          <Tooltip label={t('channelSidebar.quickSwitchTooltip')}>
            <button
              type="button"
              data-quick-switch-trigger=""
              aria-label={t('channelSidebar.quickSwitchTooltip')}
              class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => setQuickSwitchOpen(true)}
            >
              <SearchIcon class="size-3.5" />
            </button>
          </Tooltip>

          {/* View Options & Jev Controls */}
          <Dropdown placement="bottom-end">
            <Dropdown.Trigger
              as="button"
              aria-label={t('channelSidebar.viewOptionsTooltip')}
              data-view-options-trigger=""
              class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
            >
              <SlidersIcon class="size-3.5" />
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-60">
              <Dropdown.Group>
                <Dropdown.Item
                  data-open-smart-organize=""
                  onSelect={() => setOrganizeOpen(true)}
                >
                  <SparkleIcon class="size-3.5 shrink-0 text-accent" />
                  <span class="flex-1">
                    {t('channelSidebar.organizeWithJev')}
                  </span>
                </Dropdown.Item>
              </Dropdown.Group>

              <Dropdown.Separator class="my-1 h-px bg-edge-muted" />

              <Dropdown.Group>
                <Dropdown.Item
                  closeOnSelect={false}
                  onSelect={() => ws.prefs.toggleHideMuted()}
                >
                  <BellSlashIcon class="size-3.5 shrink-0 text-ink-muted" />
                  <span class="flex-1">
                    {t('channelSidebar.hideMutedChannels')}
                  </span>
                  <span class="pointer-events-none">
                    <ToggleSwitch checked={ws.prefs.prefs.hideMuted} readOnly />
                  </span>
                </Dropdown.Item>

                <Dropdown.Item
                  closeOnSelect={false}
                  onSelect={() =>
                    ws.prefs.setJevEnabled(!ws.prefs.prefs.jevEnabled)
                  }
                >
                  <SparkleIcon class="size-3.5 shrink-0 text-ink-muted" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span>{t('channelSidebar.jevTriageToggle')}</span>
                    <span class="text-[11px] text-ink-extra-muted">
                      {engineLabel()} ·{' '}
                      {ws.triage.stats().estimatedCostFormatted}
                    </span>
                  </span>
                  <span class="pointer-events-none">
                    <ToggleSwitch
                      checked={ws.prefs.prefs.jevEnabled}
                      readOnly
                    />
                  </span>
                </Dropdown.Item>

                <Show when={ws.prefs.prefs.jevEnabled}>
                  <Dropdown.Item onSelect={() => ws.triage.refresh()}>
                    <ArrowClockwiseIcon class="size-3.5 shrink-0 text-ink-muted" />
                    <span>{t('channelSidebar.refreshTriage')}</span>
                  </Dropdown.Item>
                </Show>
              </Dropdown.Group>

              <Show when={ws.placement().hiddenTeamSections.length > 0}>
                <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
                <div class="px-2 py-1 text-[11px] font-medium text-ink-extra-muted">
                  {t('channelSidebar.manageHiddenSections')}
                </div>
                <Dropdown.Group>
                  <For each={ws.placement().hiddenTeamSections}>
                    {(sec) => (
                      <Dropdown.Item
                        onSelect={() => ws.prefs.showTeamSection(sec.id)}
                      >
                        <EyeIcon class="size-3.5 shrink-0 text-accent" />
                        <span class="flex-1 truncate">{sec.name}</span>
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Group>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        </div>
      </div>

      {/* Primary Create Button slot */}
      <Show when={ws.renderCreateMenu}>
        {(renderCreate) => (
          <div class="shrink-0 px-2.5 pt-1.5 pb-1">{renderCreate()()}</div>
        )}
      </Show>

      {/* Top Lens Navigation (All / Focus / Support / Threads) */}
      <nav
        aria-label={t('channelSidebar.lensNavLabel')}
        data-lens-nav=""
        class="flex min-w-0 shrink-0 items-center gap-0.5 overflow-hidden border-b border-edge-muted/70 px-2 py-1.5"
      >
        <button
          type="button"
          data-lens-tab="browse"
          aria-current={activeLens() === 'browse' ? 'page' : undefined}
          class={cn(
            'inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors',
            activeLens() === 'browse'
              ? 'bg-active text-ink shadow-2xs'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
          )}
          onClick={() => selectLens('browse')}
        >
          <span>{t('channelSidebar.lensBrowse')}</span>
        </button>

        <button
          type="button"
          data-lens-tab="focus"
          aria-current={activeLens() === 'focus' ? 'page' : undefined}
          class={cn(
            'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors',
            activeLens() === 'focus'
              ? 'bg-active text-ink shadow-2xs'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
          )}
          onClick={() => selectLens('focus')}
        >
          <span class="truncate">{t('channelSidebar.lensFocus')}</span>
          <Show when={focusCount() > 0}>
            <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none tabular-nums text-accent-contrast">
              {focusCount() > 99 ? '99+' : focusCount()}
            </span>
          </Show>
        </button>

        <Show when={hasSupport()}>
          <button
            type="button"
            data-lens-tab="support"
            aria-current={activeLens() === 'support' ? 'page' : undefined}
            class={cn(
              'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors',
              activeLens() === 'support'
                ? 'bg-active text-ink shadow-2xs'
                : 'text-ink-muted hover:bg-hover hover:text-ink'
            )}
            onClick={() => selectLens('support')}
          >
            <span class="truncate">{t('channelSidebar.lensSupport')}</span>
            <Show when={supportWaiting() > 0}>
              <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warning/20 px-1 text-[10px] font-semibold leading-none tabular-nums text-warning">
                {supportWaiting() > 99 ? '99+' : supportWaiting()}
              </span>
            </Show>
          </button>
        </Show>

        <Show when={ws.threadsEnabled()}>
          <Tooltip label={t('channelSidebar.lensThreads')}>
            <button
              type="button"
              data-lens-tab="threads"
              aria-label={t('channelSidebar.lensThreads')}
              aria-current={activeLens() === 'threads' ? 'page' : undefined}
              class={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors',
                activeLens() === 'threads'
                  ? 'bg-active text-ink shadow-2xs'
                  : 'text-ink-muted hover:bg-hover hover:text-ink'
              )}
              onClick={() => selectLens('threads')}
            >
              <ChatCircleDotsIcon class="size-3.5 shrink-0" />
            </button>
          </Tooltip>
        </Show>
      </nav>

      {/* Live Calls strip (always above the active lens when calls are live) */}
      {ws.renderLiveCalls?.()}

      {/* Active Lens Body */}
      <Switch>
        <Match when={activeLens() === 'browse'}>
          <BrowseTree
            focusedKey={focusedKey()}
            onRegisterScrollRoot={(el) => {
              browseScrollRoot = el;
            }}
          />
        </Match>
        <Match when={activeLens() === 'focus'}>
          <FocusView focusedKey={focusedKey()} />
        </Match>
        <Match when={activeLens() === 'support'}>
          <SupportDeskView focusedKey={focusedKey()} />
        </Match>
        <Match when={activeLens() === 'threads'}>
          <div
            class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2"
            data-sidebar-lens-panel="threads"
          >
            <button
              type="button"
              class={cn(
                'flex h-8 items-center gap-2 rounded-lg px-2 text-left text-sm font-medium transition-colors',
                ws.threadsChannelId() === undefined
                  ? 'bg-active text-ink'
                  : 'text-ink-muted hover:bg-hover hover:text-ink'
              )}
              onClick={() => ws.setThreadsChannelId(undefined)}
            >
              <ChatCircleDotsIcon class="size-4 shrink-0" />
              <span>All threads</span>
            </button>
            <For
              each={ws
                .channels()
                .filter((ch) => ch.isParticipant)
                .slice(0, 80)}
            >
              {(ch) => (
                <SidebarRow
                  channel={ch}
                  rowId={`thread:${ch.id}`}
                  focused={focusedKey() === `thread:${ch.id}`}
                  onActivate={() => ws.setThreadsChannelId(ch.id)}
                />
              )}
            </For>
          </div>
        </Match>
      </Switch>

      {/* Subtle keyboard footer */}
      <div class="flex shrink-0 items-center justify-between border-t border-edge-muted/60 px-3 py-1.5 text-[11px] text-ink-extra-muted">
        <button
          type="button"
          class="flex items-center gap-1 hover:text-ink-muted"
          onClick={() => setQuickSwitchOpen(true)}
        >
          <kbd class="rounded border border-edge px-1 font-mono text-[10px]">
            ⌘J
          </kbd>
          <span>{t('channelSidebar.footerHintSwitch')}</span>
        </button>
        <span class="flex items-center gap-1">
          <kbd class="rounded border border-edge px-1 font-mono text-[10px]">
            [ ]
          </kbd>
          <span>{t('channelSidebar.footerHintJump')}</span>
        </span>
      </div>

      {/* Quick Switch Modal & Smart Organize with Jev Dialog */}
      <QuickSwitchModal
        open={quickSwitchOpen()}
        onOpenChange={setQuickSwitchOpen}
        onJumpToSection={(sectionId) => {
          setFocusedKey(`section:${sectionId}`);
          queueMicrotask(() => {
            const el = document.getElementById(
              `${ws.railId}-section:${sectionId}`
            );
            if (el && browseScrollRoot) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          });
        }}
      />

      <SmartOrganizeDialog
        open={organizeOpen()}
        onOpenChange={setOrganizeOpen}
      />
    </ViewSidebar.Root>
  );
}
