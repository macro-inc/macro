import { t } from '@app/lib/i18n';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ChecksIcon from '@icon/system/regular/checks.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import FunnelSimpleIcon from '@icon/system/regular/funnel-simple.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { formatPreviewSnippet } from '../../components/SidebarRow';
import { useSidebarWorkspace } from '../../context/sidebar-workspace-context';
import type { FocusItem } from '../../core/focus-triage';
import { buildQuickSwitchResults } from '../../core/quick-switch';
import type {
  DmFilter,
  SidebarChannel,
  SupportSenderRole,
} from '../../core/sidebar-model';
import { formatCompactAge } from '../../core/sidebar-model';
import type { SupportTriageItem } from '../../core/support-triage';

type MobileTabKey = 'all' | 'focus' | 'support' | 'dms' | `section:${string}`;

function supportSenderLabel(role: SupportSenderRole): string {
  switch (role) {
    case 'you':
      return t('channelSidebar.supportSenderYou');
    case 'teammate':
      return t('channelSidebar.supportSenderTeam');
    case 'agent':
      return t('channelSidebar.supportSenderAgent');
    default:
      return t('channelSidebar.supportSenderCustomer');
  }
}

function MobileTouchRow(props: {
  channel: SidebarChannel;
  displayName?: string;
  badgeLabel?: string;
  badgeTone?: 'warning' | 'accent' | 'neutral' | 'muted';
  previewText?: string;
  senderPrefix?: string;
  ageLabel?: string;
  urgent?: boolean;
  showMarkRead?: boolean;
}) {
  const ws = useSidebarWorkspace();
  const label = () => props.displayName ?? props.channel.name;
  const unread = () => ws.unreadIds().has(props.channel.id);
  const mentions = () => ws.mentionCounts().get(props.channel.id) ?? 0;
  const muted = () => ws.mutedIds().has(props.channel.id);
  const inCall = () => ws.activeCallChannelIds().has(props.channel.id);
  const snippet = () =>
    formatPreviewSnippet(
      props.previewText ?? props.channel.latestMessage?.content
    );
  const badgeClass = () => {
    switch (props.badgeTone) {
      case 'warning':
        return 'bg-warning/15 text-warning';
      case 'accent':
        return 'bg-accent/15 text-accent';
      case 'muted':
        return 'bg-surface-2 text-ink-extra-muted';
      default:
        return 'bg-surface-2 text-ink-muted';
    }
  };

  return (
    <div
      data-mobile-row=""
      data-channel-id={props.channel.id}
      class={cn(
        'flex min-h-13 min-w-0 items-center gap-3 rounded-xl px-3 py-2 transition-colors active:bg-active',
        muted() && 'opacity-60',
        props.urgent && 'border-l-2 border-warning rounded-l-none pl-2.5'
      )}
    >
      <button
        type="button"
        class="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left outline-none"
        onClick={() => ws.openChannel(props.channel.id)}
      >
        <span class="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
          {ws.renderChannelIcon(props.channel, 'md')}
          <Show when={inCall()}>
            <span class="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-success text-accent-contrast">
              <PhoneIcon class="size-2.5" />
            </span>
          </Show>
        </span>

        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex min-w-0 items-center gap-1.5">
            <span
              class={cn(
                'min-w-0 flex-1 truncate text-sm',
                unread() || mentions() > 0
                  ? 'font-semibold text-ink'
                  : 'font-medium text-ink'
              )}
            >
              {label()}
            </span>
            <Show when={props.channel.isAgentDm}>
              <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                {t('channelSidebar.dmAgentBadge')}
              </span>
            </Show>
            <Show when={props.ageLabel}>
              {(age) => (
                <span class="shrink-0 text-[11px] tabular-nums text-ink-extra-muted">
                  {age()}
                </span>
              )}
            </Show>
          </span>

          <Show when={props.badgeLabel || snippet()}>
            <span class="flex min-w-0 items-center gap-1.5">
              <Show when={props.badgeLabel}>
                {(badge) => (
                  <span
                    class={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                      badgeClass()
                    )}
                  >
                    {badge()}
                  </span>
                )}
              </Show>
              <Show when={snippet()}>
                {(text) => (
                  <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    <Show when={props.senderPrefix}>
                      {(prefix) => (
                        <span class="font-medium">{prefix()}: </span>
                      )}
                    </Show>
                    {text()}
                  </span>
                )}
              </Show>
            </span>
          </Show>
        </span>

        <span class="flex shrink-0 items-center gap-1.5">
          <Switch>
            <Match when={mentions() > 0}>
              <span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-contrast">
                {mentions()}
              </span>
            </Match>
            <Match when={unread() && !muted()}>
              <span
                aria-label="Unread"
                class="size-2.5 shrink-0 rounded-full bg-accent"
              />
            </Match>
          </Switch>
        </span>
      </button>

      <Show when={props.showMarkRead && (unread() || mentions() > 0)}>
        <button
          type="button"
          aria-label={t('channelSidebar.focusMarkRead')}
          data-mobile-mark-read=""
          class="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
          onClick={() =>
            fireAndForget(
              ws.markChannelsRead([props.channel.id]),
              'channels-view'
            )
          }
        >
          <CheckIcon class="size-4" />
        </button>
      </Show>
    </div>
  );
}

/**
 * Touch-first mobile & tablet presentation of the redesigned Chat sidebar.
 *
 * Uses the exact same pure triage, deduplication, DM smart-window, and Jev
 * workspace context as desktop without importing desktop layout components.
 */
export function ChannelSidebarMobileView() {
  const ws = useSidebarWorkspace();
  const [selectedTab, setSelectedTab] = createSignal<MobileTabKey>('all');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [supportQuery, setSupportQuery] = createSignal('');
  const [fyiExpanded, setFyiExpanded] = createSignal(false);
  const [resolvedExpanded, setResolvedExpanded] = createSignal(false);

  const hasSupport = () => ws.supportDesk().items.length > 0;
  const focusCount = () => ws.focusModel().actionableCount;
  const supportWaiting = () => ws.supportDesk().needsReplyCount;

  const pinnedChannels = createMemo(() =>
    ws
      .favoriteChannelIds()
      .map((id) => ws.channelById(id))
      .filter((ch): ch is SidebarChannel => Boolean(ch))
      .filter(
        (ch) =>
          !ws.prefs.prefs.unreadOnly || ws.unreadOrMentionedIds().has(ch.id)
      )
  );

  // Ordered pill tabs honoring personal hiddenTeamSectionIds
  const pillItems = createMemo<PillTabItem<MobileTabKey>[]>(() => {
    const items: PillTabItem<MobileTabKey>[] = [
      { value: 'all', label: t('channelSidebar.lensBrowse') },
      {
        value: 'focus',
        label: (
          <span class="flex items-center gap-1.5">
            <span>{t('channelSidebar.lensFocus')}</span>
            <Show when={focusCount() > 0}>
              <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none tabular-nums text-accent-contrast">
                {focusCount() > 99 ? '99+' : focusCount()}
              </span>
            </Show>
          </span>
        ),
      },
    ];

    if (hasSupport()) {
      items.push({
        value: 'support',
        label: (
          <span class="flex items-center gap-1.5">
            <span>{t('channelSidebar.lensSupport')}</span>
            <Show when={supportWaiting() > 0}>
              <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/20 px-1 text-[10px] font-semibold leading-none tabular-nums text-warning">
                {supportWaiting() > 99 ? '99+' : supportWaiting()}
              </span>
            </Show>
          </span>
        ),
      });
    }

    items.push({
      value: 'dms',
      label: t('channelSections.directMessagesPill'),
    });

    const p = ws.placement();
    for (const sec of [...p.personalSections, ...p.teamSections]) {
      items.push({
        value: `section:${sec.section.id}`,
        label: (
          <span class="flex items-center gap-1">
            <span>{sec.section.name}</span>
            <Show when={sec.section.scope === 'team'}>
              <UsersIcon class="size-3 shrink-0 opacity-70" />
            </Show>
            <Show when={sec.section.ruleContains}>
              <FunnelIcon class="size-3 shrink-0 opacity-70" />
            </Show>
          </span>
        ),
      });
    }
    return items;
  });

  // Fall back to `all` if the currently active section tab was hidden or deleted
  const activeTab = createMemo<MobileTabKey>(() => {
    const current = selectedTab();
    if (pillItems().some((item) => item.value === current)) return current;
    return 'all';
  });

  const activeSection = createMemo(() => {
    const tab = activeTab();
    if (!tab.startsWith('section:')) return undefined;
    const id = tab.slice('section:'.length);
    const p = ws.placement();
    return [...p.personalSections, ...p.teamSections].find(
      (sec) => sec.section.id === id
    );
  });

  const searchResults = createMemo(() => {
    const q = searchQuery().trim();
    if (!q) return [];
    return buildQuickSwitchResults({
      query: q,
      channels: ws.channels(),
      sections: ws.sections(),
      unreadIds: ws.unreadIds(),
      unreadOrMentionedIds: ws.unreadOrMentionedIds(),
      mentionCounts: ws.mentionCounts(),
      limit: 40,
    });
  });

  const filteredSupport = createMemo(() => {
    const q = supportQuery().trim().toLowerCase();
    const desk = ws.supportDesk();
    const match = (item: SupportTriageItem) =>
      !q ||
      item.displayName.toLowerCase().includes(q) ||
      item.channel.name.toLowerCase().includes(q) ||
      item.previewText.toLowerCase().includes(q);
    return {
      needsReply: desk.needsReplyGroup.filter(match),
      agent: desk.byState.agent_handling.filter(match),
      waiting: desk.byState.waiting_on_customer.filter(match),
      resolved: desk.byState.resolved.filter(match),
    };
  });

  const focusUnreadIds = createMemo(() => {
    const m = ws.focusModel();
    return [...m.direct, ...m.support, ...m.unread, ...m.fyi]
      .filter((item) => item.unread || item.mentions > 0)
      .map((item) => item.channel.id);
  });

  const renderFocusItem = (item: FocusItem) => {
    let badgeLabel: string | undefined;
    let badgeTone: 'warning' | 'accent' | 'neutral' | 'muted' = 'neutral';
    if (item.reason?.kind === 'urgent') {
      badgeLabel = t('channelSidebar.focusUrgentTag');
      badgeTone = 'warning';
    } else if (item.reason?.kind === 'mentioned') {
      badgeLabel = t('channelSidebar.focusMentionedTag');
      badgeTone = 'accent';
    } else if (item.reason?.kind === 'needs_reply') {
      badgeLabel = t('channelSidebar.focusNeedsReplyTag');
      badgeTone = 'warning';
    } else if (item.reason?.kind === 'waiting') {
      badgeLabel = t('channelSidebar.focusWaitingTag', {
        age: item.reason.age,
      });
      badgeTone = 'warning';
    } else if (item.reason?.kind === 'agent') {
      badgeLabel = t('channelSidebar.focusAgentTag');
      badgeTone = 'neutral';
    } else if (item.reason?.kind === 'fyi') {
      badgeLabel = t('channelSidebar.focusFyiTag');
      badgeTone = 'muted';
    }

    return (
      <MobileTouchRow
        channel={item.channel}
        displayName={item.displayName}
        badgeLabel={badgeLabel}
        badgeTone={badgeTone}
        previewText={item.previewText}
        ageLabel={item.ageLabel}
        urgent={item.reason?.kind === 'urgent'}
        showMarkRead
      />
    );
  };

  const dmFilterOptions: { key: DmFilter; label: () => string }[] = [
    { key: 'all', label: () => t('channelSidebar.dmFilterAll') },
    { key: 'people', label: () => t('channelSidebar.dmFilterPeople') },
    { key: 'agents', label: () => t('channelSidebar.dmFilterAgents') },
  ];

  const engineLabel = () => {
    const status = ws.triage.engineStatus();
    if (status === 'jev') return t('channelSidebar.jevEngineActive');
    if (status === 'paused') return t('channelSidebar.jevEnginePaused');
    return t('channelSidebar.jevEngineHeuristic');
  };

  return (
    <div
      data-channel-sidebar-mobile-redesign=""
      class="flex size-full min-h-0 flex-col overflow-hidden bg-panel text-ink"
    >
      {/* Top search & unread filter bar */}
      <div class="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1.5">
        <div class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3">
          <SearchIcon class="size-4 shrink-0 text-ink-muted" />
          <input
            type="text"
            value={searchQuery()}
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder={t('channelSidebar.quickSwitchPlaceholder')}
            aria-label={t('channelSidebar.quickSwitchPlaceholder')}
            class="h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-extra-muted focus:outline-none"
          />
          <Show when={searchQuery().length > 0}>
            <button
              type="button"
              aria-label="Clear search"
              class="flex size-7 items-center justify-center rounded-full text-ink-muted"
              onClick={() => setSearchQuery('')}
            >
              <XIcon class="size-3.5" />
            </button>
          </Show>
        </div>

        <button
          type="button"
          data-mobile-unread-toggle=""
          aria-pressed={ws.prefs.prefs.unreadOnly}
          aria-label={t('channelSidebar.unreadOnlyActive')}
          class={cn(
            'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
            ws.prefs.prefs.unreadOnly
              ? 'bg-accent text-accent-contrast'
              : 'bg-surface-2 text-ink-muted'
          )}
          onClick={() => ws.prefs.toggleUnreadOnly()}
        >
          <FunnelSimpleIcon class="size-3.5" />
          <Show when={ws.totalUnreadCount() > 0}>
            <span class="tabular-nums">{ws.totalUnreadCount()}</span>
          </Show>
        </button>
      </div>

      {/* Horizontal pinned strip (hidden while searching) */}
      <Show
        when={searchQuery().trim().length === 0 && pinnedChannels().length > 0}
      >
        <div
          role="group"
          aria-label={t('channelSidebar.pinnedHeading')}
          class="flex shrink-0 gap-2 overflow-x-auto px-3 py-1.5 scrollbar-hidden"
        >
          <For each={pinnedChannels()}>
            {(channel) => {
              const unread = () => ws.unreadIds().has(channel.id);
              const mentions = () => ws.mentionCounts().get(channel.id) ?? 0;
              return (
                <button
                  type="button"
                  data-mobile-pin={channel.id}
                  class="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-edge-muted bg-surface-1 px-3 py-1.5 text-left active:bg-active"
                  onClick={() => ws.openChannel(channel.id)}
                >
                  <span class="flex size-5 shrink-0 items-center justify-center">
                    {ws.renderChannelIcon(channel, 'sm')}
                  </span>
                  <span
                    class={cn(
                      'max-w-32 truncate text-xs',
                      unread() || mentions() > 0
                        ? 'font-semibold text-ink'
                        : 'text-ink-muted'
                    )}
                  >
                    {channel.name}
                  </span>
                  <Show when={mentions() > 0}>
                    <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-contrast">
                      {mentions()}
                    </span>
                  </Show>
                  <Show when={mentions() === 0 && unread()}>
                    <span class="size-2 shrink-0 rounded-full bg-accent" />
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Scrollable PillTabs (All / Focus / Support / DMs / Personal & Visible Team Sections) */}
      <Show when={searchQuery().trim().length === 0}>
        <nav
          aria-label={t('channelSidebar.lensNavLabel')}
          class="min-w-0 shrink-0 px-3 pt-1 pb-2"
        >
          <PillTabs
            scrollable
            class="-ml-3 w-[calc(100%+1.5rem)] max-w-none flex-none"
            contentClass="px-3"
            value={activeTab()}
            onChange={(value) => setSelectedTab(value)}
            items={pillItems()}
          />
        </nav>
      </Show>

      {/* Main scrollable content */}
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-28">
        <Show
          when={!ws.isLoading() || ws.channels().length > 0}
          fallback={
            <div class="flex flex-col gap-2 p-2" data-mobile-loading="">
              <For each={[1, 2, 3, 4, 5, 6]}>
                {() => (
                  <div class="h-12 animate-pulse rounded-xl bg-surface-2" />
                )}
              </For>
            </div>
          }
        >
          {/* Instant inline search results */}
          <Show
            when={searchQuery().trim().length === 0}
            fallback={
              <div class="flex flex-col gap-1" data-mobile-search-results="">
                <Show
                  when={searchResults().length > 0}
                  fallback={
                    <p class="px-4 py-8 text-center text-sm text-ink-muted">
                      {t('channelSidebar.quickSwitchNoMatches', {
                        query: searchQuery(),
                      })}
                    </p>
                  }
                >
                  <For each={searchResults()}>
                    {(item) =>
                      item.kind === 'channel' ? (
                        <MobileTouchRow
                          channel={item.channel}
                          displayName={item.displayName}
                        />
                      ) : (
                        <button
                          type="button"
                          class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-ink active:bg-active"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedTab(`section:${item.section.id}`);
                          }}
                        >
                          <UsersIcon class="size-4 text-ink-muted" />
                          <span class="flex-1 truncate">
                            {item.section.name}
                          </span>
                        </button>
                      )
                    }
                  </For>
                </Show>
              </div>
            }
          >
            <Switch>
              {/* FOCUS TAB */}
              <Match when={activeTab() === 'focus'}>
                <div class="flex flex-col gap-2" data-mobile-panel="focus">
                  <div class="flex items-center justify-between px-2 py-1">
                    <span class="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                      <SparkleIcon class="size-3 text-accent" />
                      {engineLabel()}
                    </span>
                    <Show when={focusUnreadIds().length > 0}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        class="min-h-9 gap-1 px-2 text-xs text-ink-muted"
                        onClick={() =>
                          fireAndForget(
                            ws.markChannelsRead(focusUnreadIds()),
                            'channels-view'
                          )
                        }
                      >
                        <ChecksIcon class="size-3.5" />
                        <span>{t('channelSidebar.focusSweepRead')}</span>
                      </Button>
                    </Show>
                  </div>

                  <Show
                    when={ws.focusModel().totalCount > 0}
                    fallback={
                      <div class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                        <CheckCircleIcon class="size-9 text-success/80" />
                        <p class="text-sm font-semibold text-ink">
                          {t('channelSidebar.focusAllClearTitle')}
                        </p>
                        <p class="text-xs text-ink-muted">
                          {t('channelSidebar.focusAllClearDescription')}
                        </p>
                      </div>
                    }
                  >
                    <Show when={ws.focusModel().direct.length > 0}>
                      <div class="px-2 pt-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                        {t('channelSidebar.focusBucketDirect')} ·{' '}
                        {ws.focusModel().direct.length}
                      </div>
                      <For each={ws.focusModel().direct}>{renderFocusItem}</For>
                    </Show>

                    <Show when={ws.focusModel().support.length > 0}>
                      <div class="flex items-center justify-between px-2 pt-2">
                        <span class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                          {t('channelSidebar.focusBucketSupport')} ·{' '}
                          {ws.focusModel().support.length}
                        </span>
                        <button
                          type="button"
                          class="text-xs font-medium text-accent"
                          onClick={() => setSelectedTab('support')}
                        >
                          {t('channelSidebar.openSupportDesk')}
                        </button>
                      </div>
                      <For each={ws.focusModel().support}>
                        {renderFocusItem}
                      </For>
                    </Show>

                    <Show when={ws.focusModel().unread.length > 0}>
                      <div class="px-2 pt-2 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                        {t('channelSidebar.focusBucketUnread')} ·{' '}
                        {ws.focusModel().unread.length}
                      </div>
                      <For each={ws.focusModel().unread}>{renderFocusItem}</For>
                    </Show>

                    <Show when={ws.focusModel().fyi.length > 0}>
                      <button
                        type="button"
                        class="flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-medium text-ink-muted"
                        onClick={() => setFyiExpanded((v) => !v)}
                      >
                        <Show
                          when={fyiExpanded()}
                          fallback={<CaretRightIcon class="size-3.5" />}
                        >
                          <CaretDownIcon class="size-3.5" />
                        </Show>
                        <span>
                          {t('channelSidebar.focusBucketFyi')} (
                          {ws.focusModel().fyi.length})
                        </span>
                      </button>
                      <Show when={fyiExpanded()}>
                        <For each={ws.focusModel().fyi}>{renderFocusItem}</For>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </Match>

              {/* SUPPORT DESK TAB */}
              <Match when={activeTab() === 'support'}>
                <div class="flex flex-col gap-2" data-mobile-panel="support">
                  <div class="flex items-center justify-between px-2">
                    <div class="flex items-center gap-1.5 text-xs">
                      <span class="rounded-full bg-warning/15 px-2 py-0.5 font-semibold tabular-nums text-warning">
                        {t('channelSidebar.supportWaitingSummary', {
                          count: ws.supportDesk().needsReplyCount,
                        })}
                      </span>
                      <Show when={ws.supportDesk().urgentCount > 0}>
                        <span class="font-medium tabular-nums text-ink-muted">
                          ·{' '}
                          {t('channelSidebar.supportUrgentSummary', {
                            count: ws.supportDesk().urgentCount,
                          })}
                        </span>
                      </Show>
                    </div>
                    <span class="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                      <SparkleIcon class="size-3 text-accent" />
                      {engineLabel()}
                    </span>
                  </div>

                  <div class="px-1">
                    <div class="flex h-10 items-center gap-2 rounded-lg border border-edge-muted bg-surface-1 px-2.5">
                      <SearchIcon class="size-3.5 text-ink-muted" />
                      <input
                        type="text"
                        value={supportQuery()}
                        onInput={(e) => setSupportQuery(e.currentTarget.value)}
                        placeholder={t(
                          'channelSidebar.supportFilterPlaceholder'
                        )}
                        aria-label={t(
                          'channelSidebar.supportFilterPlaceholder'
                        )}
                        class="h-full min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-extra-muted focus:outline-none"
                      />
                    </div>
                  </div>

                  <Show when={filteredSupport().needsReply.length > 0}>
                    <div
                      data-mobile-support-bucket="needs_reply"
                      class="flex flex-col gap-0.5"
                    >
                      <div class="px-2 pt-1 text-[11px] font-semibold tracking-wide text-warning uppercase">
                        {t('channelSidebar.supportBucketNeedsReply')} ·{' '}
                        {filteredSupport().needsReply.length}
                      </div>
                      <For each={filteredSupport().needsReply}>
                        {(item) => (
                          <MobileTouchRow
                            channel={item.channel}
                            displayName={item.displayName}
                            badgeLabel={
                              item.state === 'urgent'
                                ? t('channelSidebar.supportStateUrgent')
                                : t('channelSidebar.supportStateNeedsReply')
                            }
                            badgeTone="warning"
                            previewText={item.previewText}
                            senderPrefix={supportSenderLabel(item.senderRole)}
                            ageLabel={item.waitAgeLabel}
                            urgent={item.state === 'urgent'}
                            showMarkRead
                          />
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={filteredSupport().agent.length > 0}>
                    <div
                      data-mobile-support-bucket="agent_handling"
                      class="flex flex-col gap-0.5"
                    >
                      <div class="px-2 pt-2 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                        {t('channelSidebar.supportBucketAgentHandling')} ·{' '}
                        {filteredSupport().agent.length}
                      </div>
                      <For each={filteredSupport().agent}>
                        {(item) => (
                          <MobileTouchRow
                            channel={item.channel}
                            displayName={item.displayName}
                            badgeLabel={t('channelSidebar.supportStateAgent')}
                            badgeTone="neutral"
                            previewText={item.previewText}
                            ageLabel={item.waitAgeLabel}
                          />
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={filteredSupport().waiting.length > 0}>
                    <div
                      data-mobile-support-bucket="waiting_on_customer"
                      class="flex flex-col gap-0.5"
                    >
                      <div class="px-2 pt-2 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                        {t('channelSidebar.supportBucketWaitingCustomer')} ·{' '}
                        {filteredSupport().waiting.length}
                      </div>
                      <For each={filteredSupport().waiting}>
                        {(item) => (
                          <MobileTouchRow
                            channel={item.channel}
                            displayName={item.displayName}
                            badgeLabel={t('channelSidebar.supportStateWaiting')}
                            badgeTone="muted"
                            previewText={item.previewText}
                            ageLabel={item.waitAgeLabel}
                          />
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={filteredSupport().resolved.length > 0}>
                    <div data-mobile-support-bucket="resolved">
                      <button
                        type="button"
                        class="flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-medium text-ink-muted"
                        onClick={() => setResolvedExpanded((v) => !v)}
                      >
                        <Show
                          when={resolvedExpanded()}
                          fallback={<CaretRightIcon class="size-3.5" />}
                        >
                          <CaretDownIcon class="size-3.5" />
                        </Show>
                        <span>
                          {t('channelSidebar.supportBucketResolved')} (
                          {filteredSupport().resolved.length})
                        </span>
                      </button>
                      <Show when={resolvedExpanded()}>
                        <For each={filteredSupport().resolved}>
                          {(item) => (
                            <MobileTouchRow
                              channel={item.channel}
                              displayName={item.displayName}
                              badgeLabel={t(
                                'channelSidebar.supportStateResolved'
                              )}
                              badgeTone="muted"
                              previewText={item.previewText}
                              ageLabel={item.waitAgeLabel}
                            />
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Match>

              {/* DIRECT MESSAGES TAB */}
              <Match when={activeTab() === 'dms'}>
                <div class="flex flex-col gap-2" data-mobile-panel="dms">
                  <div class="flex items-center gap-1.5 px-2">
                    <For each={dmFilterOptions}>
                      {(opt) => (
                        <button
                          type="button"
                          data-mobile-dm-filter={opt.key}
                          aria-pressed={ws.prefs.prefs.dmFilter === opt.key}
                          class={cn(
                            'min-h-9 rounded-full px-3 text-xs font-medium transition-colors',
                            ws.prefs.prefs.dmFilter === opt.key
                              ? 'bg-active text-ink'
                              : 'bg-surface-2 text-ink-muted'
                          )}
                          onClick={() => ws.prefs.setDmFilter(opt.key)}
                        >
                          {opt.label()}
                        </button>
                      )}
                    </For>
                  </div>

                  <For each={ws.dmWindow().visible}>
                    {(dm) => (
                      <MobileTouchRow
                        channel={dm}
                        ageLabel={formatCompactAge(
                          Math.max(0, Date.now() - dm.updatedAtMs)
                        )}
                      />
                    )}
                  </For>

                  <Show when={ws.dmWindow().overflowCount > 0}>
                    <button
                      type="button"
                      data-mobile-dm-show-more=""
                      class="min-h-11 rounded-xl bg-surface-2 px-4 text-xs font-medium text-ink-muted"
                      onClick={() => ws.prefs.setDmExpandedAll(true)}
                    >
                      {t('channelSidebar.dmShowMore', {
                        count: ws.dmWindow().overflowCount,
                      })}
                    </button>
                  </Show>
                  <Show
                    when={
                      ws.prefs.prefs.dmExpandedAll &&
                      ws.prefs.prefs.dmWindowLimit !== 'all' &&
                      ws.dmWindow().totalFilteredCount >
                        ws.prefs.prefs.dmWindowLimit
                    }
                  >
                    <button
                      type="button"
                      class="min-h-11 rounded-xl bg-surface-2 px-4 text-xs font-medium text-ink-muted"
                      onClick={() => ws.prefs.setDmExpandedAll(false)}
                    >
                      {t('channelSidebar.dmShowLess')}
                    </button>
                  </Show>
                </div>
              </Match>

              {/* SINGLE SECTION TAB */}
              <Match when={activeSection()}>
                {(sec) => (
                  <div
                    class="flex flex-col gap-1"
                    data-mobile-panel={`section:${sec().section.id}`}
                  >
                    <div class="flex items-center justify-between px-2 py-1">
                      <span class="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                        <span>{sec().section.name}</span>
                        <span class="tabular-nums text-ink-extra-muted">
                          ({sec().allChannels.length})
                        </span>
                      </span>
                      <div class="flex items-center gap-1">
                        <Show when={sec().isSupport}>
                          <button
                            type="button"
                            class="min-h-9 rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning"
                            onClick={() => setSelectedTab('support')}
                          >
                            {t('channelSidebar.openSupportDesk')}
                          </button>
                        </Show>
                        <Show when={sec().section.scope === 'team'}>
                          <button
                            type="button"
                            data-mobile-hide-section={sec().section.id}
                            class="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-xs font-medium text-ink-muted"
                            onClick={() => {
                              ws.prefs.hideTeamSection(sec().section.id);
                              setSelectedTab('all');
                            }}
                          >
                            <EyeSlashIcon class="size-3.5" />
                            <span>{t('channelSidebar.hideSectionForMe')}</span>
                          </button>
                        </Show>
                      </div>
                    </div>

                    <For each={sec().allChannels}>
                      {(entry) => (
                        <MobileTouchRow
                          channel={entry.channel}
                          displayName={entry.displayName}
                        />
                      )}
                    </For>
                  </div>
                )}
              </Match>

              {/* ALL TAB (DEDUPLICATED SPATIAL MAP) */}
              <Match when={activeTab() === 'all'}>
                <div class="flex flex-col gap-3" data-mobile-panel="all">
                  {/* Bounded Direct Messages */}
                  <section
                    class="flex flex-col gap-1"
                    data-mobile-dm-section=""
                  >
                    <div class="flex items-center justify-between px-2">
                      <span class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                        {t('channelSidebar.dmHeading')}
                      </span>
                      <div class="flex items-center gap-1">
                        <For each={dmFilterOptions}>
                          {(opt) => (
                            <button
                              type="button"
                              data-mobile-dm-filter={opt.key}
                              aria-pressed={ws.prefs.prefs.dmFilter === opt.key}
                              class={cn(
                                'min-h-8 rounded-full px-2.5 text-[11px] font-medium',
                                ws.prefs.prefs.dmFilter === opt.key
                                  ? 'bg-active text-ink'
                                  : 'text-ink-muted'
                              )}
                              onClick={() => ws.prefs.setDmFilter(opt.key)}
                            >
                              {opt.label()}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>

                    <For each={ws.dmWindow().visible}>
                      {(dm) => <MobileTouchRow channel={dm} />}
                    </For>

                    <Show when={ws.dmWindow().overflowCount > 0}>
                      <button
                        type="button"
                        data-mobile-dm-show-more=""
                        class="mx-2 min-h-10 rounded-lg bg-surface-2 px-3 text-left text-xs font-medium text-ink-muted"
                        onClick={() => ws.prefs.setDmExpandedAll(true)}
                      >
                        {t('channelSidebar.dmShowMore', {
                          count: ws.dmWindow().overflowCount,
                        })}
                      </button>
                    </Show>
                    <Show
                      when={
                        ws.prefs.prefs.dmExpandedAll &&
                        ws.prefs.prefs.dmWindowLimit !== 'all' &&
                        ws.dmWindow().totalFilteredCount >
                          ws.prefs.prefs.dmWindowLimit
                      }
                    >
                      <button
                        type="button"
                        data-mobile-dm-show-less=""
                        class="mx-2 min-h-10 rounded-lg bg-surface-2 px-3 text-left text-xs font-medium text-ink-muted"
                        onClick={() => ws.prefs.setDmExpandedAll(false)}
                      >
                        {t('channelSidebar.dmShowLess')}
                      </button>
                    </Show>
                  </section>

                  {/* Personal Sections */}
                  <Show when={ws.placement().personalSections.length > 0}>
                    <section class="flex flex-col gap-2">
                      <div class="px-2 text-[11px] font-semibold tracking-wide text-ink-extra-muted uppercase">
                        {t('channelSidebar.personalZone')}
                      </div>
                      <For each={ws.placement().personalSections}>
                        {(sec) => (
                          <div
                            class="flex flex-col gap-0.5"
                            data-mobile-section={sec.section.id}
                          >
                            <div class="flex items-center justify-between px-2">
                              <span class="text-xs font-semibold text-ink-muted">
                                {sec.section.name}
                              </span>
                              <Show
                                when={
                                  sec.isSupport &&
                                  ws.supportDesk().needsReplyCount > 0
                                }
                              >
                                <button
                                  type="button"
                                  class="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning"
                                  onClick={() => setSelectedTab('support')}
                                >
                                  {t('channelSidebar.supportWaitingSummary', {
                                    count: ws.supportDesk().needsReplyCount,
                                  })}
                                </button>
                              </Show>
                            </div>
                            <For each={sec.visibleChannels}>
                              {(entry) => (
                                <MobileTouchRow
                                  channel={entry.channel}
                                  displayName={entry.displayName}
                                />
                              )}
                            </For>
                            <Show when={sec.overflowCount > 0}>
                              <button
                                type="button"
                                class="mx-2 min-h-10 rounded-lg bg-surface-2 px-3 text-left text-xs font-medium text-ink-muted"
                                onClick={() =>
                                  ws.prefs.toggleLargeSectionExpanded(
                                    sec.section.id
                                  )
                                }
                              >
                                {t('channelSidebar.sectionShowMore', {
                                  count: sec.overflowCount,
                                })}
                              </button>
                            </Show>
                          </div>
                        )}
                      </For>
                    </section>
                  </Show>

                  {/* Team Sections (deduplicated + personal Hide support) */}
                  <Show
                    when={
                      ws.placement().teamSections.length > 0 ||
                      ws.placement().hiddenTeamSections.length > 0
                    }
                  >
                    <section class="flex flex-col gap-2">
                      <div class="px-2 text-[11px] font-semibold tracking-wide text-ink-extra-muted uppercase">
                        {ws.teamName()
                          ? t('channelSidebar.teamZone', {
                              name: ws.teamName() ?? '',
                            })
                          : t('channelSidebar.teamZoneFallback')}
                      </div>

                      <For each={ws.placement().teamSections}>
                        {(sec) => (
                          <div
                            class="flex flex-col gap-0.5"
                            data-mobile-section={sec.section.id}
                          >
                            <div class="flex items-center justify-between px-2">
                              <span class="text-xs font-semibold text-ink-muted">
                                {sec.section.name}
                              </span>
                              <button
                                type="button"
                                data-mobile-hide-section={sec.section.id}
                                aria-label={`${t('channelSidebar.hideSectionForMe')}: ${sec.section.name}`}
                                class="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[11px] text-ink-extra-muted hover:bg-hover hover:text-ink"
                                onClick={() =>
                                  ws.prefs.hideTeamSection(sec.section.id)
                                }
                              >
                                <EyeSlashIcon class="size-3.5" />
                              </button>
                            </div>
                            <For each={sec.visibleChannels}>
                              {(entry) => (
                                <MobileTouchRow
                                  channel={entry.channel}
                                  displayName={entry.displayName}
                                />
                              )}
                            </For>
                          </div>
                        )}
                      </For>

                      {/* Restore hidden team sections bar */}
                      <Show when={ws.placement().hiddenTeamSections.length > 0}>
                        <div
                          data-mobile-restore-hidden=""
                          class="mx-2 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-muted"
                        >
                          <span class="inline-flex items-center gap-1.5">
                            <EyeIcon class="size-3.5" />
                            {t('channelSidebar.hiddenSectionsCount', {
                              count: ws.placement().hiddenTeamSections.length,
                            })}
                          </span>
                          <button
                            type="button"
                            class="min-h-8 font-medium text-accent"
                            onClick={() =>
                              ws.prefs.restoreAllHiddenTeamSections()
                            }
                          >
                            {t('channelSidebar.restoreAllHidden')}
                          </button>
                        </div>
                      </Show>
                    </section>
                  </Show>

                  {/* Ungrouped Channels */}
                  <Show when={ws.placement().ungroupedChannels.length > 0}>
                    <section class="flex flex-col gap-0.5">
                      <div class="px-2 text-[11px] font-semibold tracking-wide text-ink-extra-muted uppercase">
                        {t('channelSidebar.ungroupedChannels')}
                      </div>
                      <For each={ws.placement().ungroupedChannels}>
                        {(channel) => <MobileTouchRow channel={channel} />}
                      </For>
                    </section>
                  </Show>
                </div>
              </Match>
            </Switch>
          </Show>
        </Show>
      </div>
    </div>
  );
}
