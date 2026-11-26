import { ViewSidebar } from '@app/components/view-shell';
import { runCreateAction } from '@app/features/command/Launcher';
import {
  channelPreviewSelection,
  getChannelEntityTarget,
  markChannelNotificationsSeenOnOpen,
  navigateChannelEntityToTarget,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { t } from '@app/lib/i18n';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { prefetchLatestChannelMessages } from '@channel/queries/prefetch-channel-target';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { useChannelDirectory } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import type { ChannelEntity } from '@entity';
import { isMutedItem } from '@entity/utils/notification';
import SplitIcon from '@icon/system/regular/arrow-square-out.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import PushPinIcon from '@icon/system/regular/push-pin.svg';
import PushPinSlashIcon from '@icon/system/regular/push-pin-slash.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { markChannelsAsRead } from '@notifications/notification-helpers';
import { queryAccountSession } from '@queries/auth/account-scope';
import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import {
  useChannelSectionsQuery,
  useCreateChannelLabelMutation,
  useSetChannelLabelMutation,
} from '@queries/channel-labels/channel-labels';
import {
  useAddFavoriteMutation,
  useFavoritesData,
  useRemoveFavoriteMutation,
  useReorderFavoritesMutation,
} from '@queries/favorites/favorites';
import { queryReadyGate } from '@queries/gate';
import { useBulkNotificationPreferencesMutation } from '@queries/notification/unsubscribes';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  getOwner,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { useChannelsView } from '../../channels-view-context';
import { ConversationsCreateMenu } from '../../components/ConversationsCreateMenu';
import { ChannelAvatar } from '../../components/rail/ChannelRailItems';
import { rowKeyForFavorite } from '../../components/rail/ChannelsRailContext';
import { useChannelCalls } from '../../components/rail/hooks/useChannelCalls';
import { useChannelLabelActions } from '../../components/rail/hooks/useChannelLabelActions';
import { useChannelRailActivity } from '../../components/rail/hooks/useChannelRailActivity';
import { useChannelSectionNotifications } from '../../components/rail/hooks/useChannelSectionNotifications';
import { createSectionSearchSource } from '../../components/rail/next/channel-discovery-source';
import { reorderVisibleFavorites } from '../../components/rail/next/useFavoriteReorder';
import { canAssignChannel } from '../../core/channel-label-eligibility';
import { resolveChannelLabelMemberships } from '../../core/smart-tags';
import { ChannelsLiveCallsSidebar } from '../../live-calls-sidebar';
import { type ChannelsSources, deduplicateChannels } from '../../queries';
import type { ChannelSectionKey } from '../../types';
import type {
  SectionSortMode,
  SidebarBuiltInGroup,
  SidebarCreateSectionInput,
  SidebarWorkspaceContextValue,
} from '../context/sidebar-workspace-context';
import { buildBrowsePlacement } from '../core/deduplicate-placement';
import { buildDmWindow } from '../core/dm-window';
import { buildFocusModel } from '../core/focus-triage';
import {
  LARGE_SECTION_SMART_LIMIT,
  type SidebarChannel,
  type SidebarLens,
  type SidebarSection,
} from '../core/sidebar-model';
import {
  buildSupportDeskModel,
  isSupportChannel,
  isSupportSection,
} from '../core/support-triage';
import {
  collectWindowedReferencedChannelIds,
  DEFAULT_CHANNEL_RESOLUTION_WINDOW,
  DEFAULT_MAX_TOTAL_RESOLVED_IDS,
  DEFAULT_SUPPORT_LENS_WINDOW,
  SECTION_WINDOW_PAGE_STEP,
  searchDirectoryTopK,
} from '../core/windowed-resolution';
import {
  toSidebarChannel,
  toSidebarChannelFromDirectory,
  toSidebarSection,
} from '../queries/adapt-channel';
import { useBoundedUnreadChannels } from '../queries/bounded-unread-channels';
import { liveJevDecide } from '../queries/jev-decide';
import { createJevTriageController } from './create-jev-triage';
import { createSidebarPreferences } from './create-sidebar-preferences';

const JEV_CANDIDATE_POOL_CAP = 100;

export function createLiveSidebarWorkspace(options: {
  sources: ChannelsSources;
  localChannels: Accessor<ChannelEntity[]>;
  openPreview?: (channel: ChannelEntity) => boolean;
}): SidebarWorkspaceContextValue {
  const railId = createUniqueId();
  const userId = useUserId();
  const directory = useChannelDirectory();
  const notificationSource = useGlobalNotificationSource();
  const orchestrator = useGlobalBlockOrchestrator();
  const panel = useSplitPanelOrThrow();
  const teamQuery = useCurrentTeamQuery();
  const {
    state,
    mobileLayout,
    selectedChannel,
    setSelectedChannel,
    setGroupOpen: setViewGroupOpen,
    setLabelOpen,
    setSectionPreferences,
    setSectionOrder: setViewSectionOrder,
    tab,
    setTab,
    threadsEnabled,
    threadsChannelId,
    setThreadsChannelId,
  } = useChannelsView();

  const prefs = createSidebarPreferences({ userId });
  const [dmQuery, setDmQuery] = createSignal('');
  const [quickSwitchOpen, setQuickSwitchOpen] = createSignal(false);
  const [quickSwitchQuery, setQuickSwitchQuery] = createSignal('');
  const [sectionWindowLimits, setSectionWindowLimits] = createSignal<
    ReadonlyMap<string, number>
  >(new Map());
  const [supportWindowLimit, setSupportWindowLimit] = createSignal(
    DEFAULT_SUPPORT_LENS_WINDOW
  );
  const [nowTick, setNowTick] = createSignal(Date.now());
  // Refresh relative wait ages every 60s without re-fetching anything.
  const ageTimer = setInterval(() => setNowTick(Date.now()), 60_000);
  const owner = getOwner();
  onCleanup(() => clearInterval(ageTimer));

  // Channel sections (team shared + personal private) using additive `/channel-sections`
  const teamSectionsQuery = useChannelSectionsQuery();
  const personalSectionsQuery = useChannelSectionsQuery('personal');
  const createPersonalMutation = useCreateChannelLabelMutation('personal');
  const createTeamMutation = useCreateChannelLabelMutation();
  const assignPersonalMutation = useSetChannelLabelMutation('personal');
  const assignTeamMutation = useSetChannelLabelMutation();

  // Complete favorites list so reordering channels preserves document/task slots.
  const favoritesData = useFavoritesData();
  const addFavorite = useAddFavoriteMutation();
  const removeFavorite = useRemoveFavoriteMutation();
  const reorderFavoritesMutation = useReorderFavoritesMutation();
  const joinMutation = useJoinChannelMutation();
  const bulkNotificationPrefs = useBulkNotificationPreferencesMutation();

  // Bounded unread-channel projection (capped at 2 pages = 200 most recent unreads)
  // so noisy accounts with thousands of unreads never auto-drain unbounded pages.
  const boundedUnread = useBoundedUnreadChannels(() => true, { maxPages: 2 });

  // Discoverable unjoined team channels while Quick Switch is open.
  const quickSwitchDiscovery = createSectionSearchSource({
    enabled: quickSwitchOpen,
    text: quickSwitchQuery,
    recent: () => options.sources.recents,
    localChannels: options.localChannels,
  });

  const favorites = createMemo(() => favoritesData()?.favorites ?? []);
  const favoriteChannelIds = createMemo(() =>
    favorites()
      .filter((fav) => fav.entityType === 'channel')
      .map((fav) => fav.entityId)
  );

  // Strictly bounded loaded Soup rows (no eager full-directory dump!).
  const loadedEntities = createMemo(() =>
    deduplicateChannels([
      options.sources.team_channels.items(),
      options.sources.channels.items(),
      options.sources.direct_messages.items(),
      options.sources.recents.items(),
      boundedUnread.channels(),
    ])
  );

  const loadedEntityIds = createMemo(
    () => new Set(loadedEntities().map((ch) => ch.id))
  );

  const earlyUnreadIds = createMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const ch of boundedUnread.channels()) set.add(ch.id);
    for (const ch of loadedEntities()) {
      if (
        (ch.unreadNotifications && ch.unreadNotifications.length > 0) ||
        (ch.unreadMentions && ch.unreadMentions.length > 0)
      ) {
        set.add(ch.id);
      }
    }
    return set;
  });

  const rawLabelsUnresolved = createMemo<readonly ChannelLabel[]>(() => {
    const shared =
      !teamSectionsQuery.isPending && teamSectionsQuery.data?.teamId
        ? teamSectionsQuery.data.labels
        : [];
    const personal = !personalSectionsQuery.isPending
      ? (personalSectionsQuery.data?.labels ?? [])
      : [];
    return [...shared, ...personal];
  });

  const rawSectionsUnresolved = createMemo<SidebarSection[]>(() =>
    rawLabelsUnresolved().map(toSidebarSection)
  );

  const activeLens = createMemo<SidebarLens>(() =>
    tab() === 'threads' ? 'threads' : prefs.prefs.activeLens
  );

  const hiddenTeamSectionIdSet = createMemo<ReadonlySet<string>>(
    () => new Set(prefs.prefs.hiddenTeamSectionIds)
  );

  const openSectionIds = createMemo<ReadonlySet<string>>(() => {
    const collapsed = new Set(state.collapsedLabels);
    const hidden = hiddenTeamSectionIdSet();
    const set = new Set<string>();
    for (const sec of rawSectionsUnresolved()) {
      if (collapsed.has(sec.id)) continue;
      if (sec.scope === 'personal' && prefs.prefs.collapsedPersonalZone) {
        continue;
      }
      if (
        sec.scope === 'team' &&
        (prefs.prefs.collapsedTeamZone || hidden.has(sec.id))
      ) {
        continue;
      }
      set.add(sec.id);
    }
    return set;
  });

  const effectiveSectionWindowLimits = createMemo<ReadonlyMap<string, number>>(
    () => {
      const limits = new Map(sectionWindowLimits());
      for (const id of prefs.prefs.expandedLargeSectionIds) {
        if (!limits.has(id)) {
          limits.set(id, LARGE_SECTION_SMART_LIMIT + SECTION_WINDOW_PAGE_STEP);
        }
      }
      return limits;
    }
  );

  // Windowed by-ID resolution: resolves ONLY missing channels inside expanded
  // sections (capped per section and globally), open Pinned favorites, or the
  // active Support lens window. Collapsed/hidden sections resolve 0 rows.
  const windowedMissingIds = createMemo(() =>
    collectWindowedReferencedChannelIds({
      sections: rawSectionsUnresolved(),
      favoriteChannelIds: favoriteChannelIds(),
      loadedIds: loadedEntityIds(),
      unreadIds: earlyUnreadIds(),
      activeLens: activeLens(),
      favoritesOpen: state.expandedGroups.favorites,
      openSectionIds: openSectionIds(),
      hiddenTeamSectionIds: hiddenTeamSectionIdSet(),
      sectionWindowLimits: effectiveSectionWindowLimits(),
      supportWindowLimit: supportWindowLimit(),
      window: DEFAULT_CHANNEL_RESOLUTION_WINDOW,
    })
  );

  const referencedChannels = useCachedChannelsByIds(
    windowedMissingIds,
    () => windowedMissingIds().length > 0
  );

  const allEntities = createMemo(() =>
    deduplicateChannels([loadedEntities(), referencedChannels.channels()])
  );
  const entityById = createMemo(
    () => new Map(allEntities().map((ch) => [ch.id, ch]))
  );

  // Reference-cached adaptation over ONLY the bounded loaded entities (never
  // mapping the full multi-thousand channel directory on every update).
  const adaptedCache = new WeakMap<ChannelEntity, SidebarChannel>();
  const channels = createMemo<SidebarChannel[]>(() =>
    allEntities().map((entity) => {
      let adapted = adaptedCache.get(entity);
      if (!adapted) {
        adapted = toSidebarChannel(entity);
        adaptedCache.set(entity, adapted);
      }
      return adapted;
    })
  );

  const channelsById = createMemo(
    () => new Map(channels().map((ch) => [ch.id, ch]))
  );

  // Resolve smart-section memberships against loaded entities while preserving server-side matches
  const resolvedLabels = createMemo<readonly ChannelLabel[]>(() =>
    resolveChannelLabelMemberships(rawLabelsUnresolved(), allEntities())
  );
  const rawLabelMap = createMemo(
    () => new Map(resolvedLabels().map((label) => [label.id, label]))
  );
  const sections = createMemo<SidebarSection[]>(() =>
    resolvedLabels().map(toSidebarSection)
  );

  const sharedLabels = () =>
    !teamSectionsQuery.isPending && Boolean(teamSectionsQuery.data?.teamId);
  const labelsAvailable = () =>
    !teamSectionsQuery.isPending &&
    Boolean(teamSectionsQuery.data) &&
    !personalSectionsQuery.isPending &&
    Boolean(personalSectionsQuery.data);
  const labelsFailed = () =>
    !labelsAvailable() &&
    !teamSectionsQuery.isPending &&
    !personalSectionsQuery.isPending &&
    (teamSectionsQuery.isError || personalSectionsQuery.isError);
  const labelsUnavailableReason = () => {
    if (labelsAvailable()) return '';
    if (teamSectionsQuery.isPending || personalSectionsQuery.isPending) {
      return t('channelSections.loading');
    }
    const err = teamSectionsQuery.error ?? personalSectionsQuery.error;
    if (
      thrownResultErrorHasCode(err, 'UNAUTHORIZED') ||
      thrownResultErrorHasCode(err, 'FORBIDDEN')
    ) {
      return t('channelSections.noAccess');
    }
    return t('channelSections.unavailable');
  };

  // Activity, calls, unread, mentions, muted
  const channelCalls = useChannelCalls();
  const favoriteEntities = createMemo(() =>
    favoriteChannelIds().flatMap((id) => {
      const entity = entityById().get(id);
      return entity ? [entity] : [];
    })
  );
  const channelActivity = useChannelRailActivity(
    allEntities,
    channelCalls,
    favoriteEntities
  );

  const unreadIds = createMemo(() => channelActivity.unreadChannelIds());
  const unreadOrMentionedIds = createMemo(() =>
    channelActivity.unreadOrMentionedChannelIds()
  );
  const mentionCounts = createMemo<ReadonlyMap<string, number>>(() => {
    const map = new Map<string, number>();
    for (const ch of channels()) {
      const count = channelActivity.mentionCount(ch.id);
      if (count > 0) map.set(ch.id, count);
    }
    return map;
  });

  const mutedIds = createMemo<ReadonlySet<string>>(() => {
    const mutedList = notificationSource.mutedEntities();
    const set = new Set<string>();
    for (const ch of channels()) {
      if (isMutedItem(mutedList, { item_id: ch.id, item_type: 'channel' })) {
        set.add(ch.id);
      }
    }
    return set;
  });

  const activeCallChannelIds = createMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const [id] of channelCalls.callStatuses()) set.add(id);
    for (const [id] of channelCalls.incomingCallIds()) set.add(id);
    return set;
  });

  const teamName = createMemo(() =>
    queryReadyGate(teamQuery) ? teamQuery.data?.team.name : undefined
  );
  const teamId = createMemo(() =>
    queryReadyGate(teamQuery)
      ? teamQuery.data?.team.id
      : !teamSectionsQuery.isPending
        ? (teamSectionsQuery.data?.teamId ?? undefined)
        : undefined
  );
  const teamMemberIds = createMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    const uid = userId();
    if (uid) set.add(uid);
    if (queryReadyGate(teamQuery) && teamQuery.data?.members) {
      for (const m of teamQuery.data.members) {
        if (m.user_id) set.add(m.user_id);
      }
    }
    return set;
  });

  // Support Desk channel identification (pure ID check — no duplicate triage pass, no nowTick)
  const supportSectionMemberIds = createMemo<ReadonlySet<string>>(() => {
    const hidden = hiddenTeamSectionIdSet();
    const set = new Set<string>();
    for (const section of sections()) {
      if (section.scope === 'team' && hidden.has(section.id)) continue;
      if (!isSupportSection(section)) continue;
      for (const id of section.channelIds) set.add(id);
    }
    return set;
  });

  const supportChannelIds = createMemo<ReadonlySet<string>>(() => {
    const sectionIds = supportSectionMemberIds();
    const set = new Set<string>();
    for (const ch of channels()) {
      if (!ch.isParticipant) continue;
      if (isSupportChannel(ch, sectionIds)) set.add(ch.id);
    }
    return set;
  });

  // Gate Jev triage strictly to active triage surfaces (Focus, Support Desk,
  // or an expanded Support section) so cold Browse loads fire 0 Jev calls.
  const jevTriageActive = createMemo(() => {
    const lens = activeLens();
    if (lens === 'focus' || lens === 'support') return true;
    if (lens !== 'browse') return false;
    const openIds = openSectionIds();
    return sections().some(
      (section) => isSupportSection(section) && openIds.has(section.id)
    );
  });

  // Feed Jev ONLY the bounded active/support candidate slice (capped at 100).
  const jevCandidateChannels = createMemo<SidebarChannel[]>(() => {
    const supportIds = supportChannelIds();
    const unread = unreadOrMentionedIds();
    const list: SidebarChannel[] = [];
    for (const ch of channels()) {
      if (supportIds.has(ch.id) || unread.has(ch.id)) {
        list.push(ch);
        if (list.length >= JEV_CANDIDATE_POOL_CAP) break;
      }
    }
    return list;
  });

  const triage = createJevTriageController({
    accountKey: () =>
      userId() ? `${userId()}:${queryAccountSession()}` : undefined,
    userId,
    enabled: () => prefs.prefs.jevEnabled,
    active: jevTriageActive,
    channels: jevCandidateChannels,
    supportChannelIds,
    unreadOrMentionedIds,
    mentionCounts,
    teamMemberIds,
    decide: liveJevDecide,
  });

  const supportDesk = createMemo(() =>
    buildSupportDeskModel({
      channels: channels(),
      sections: sections(),
      currentUserId: userId(),
      teamMemberIds: teamMemberIds(),
      unreadIds: unreadIds(),
      mentionCounts: mentionCounts(),
      triageByChannelId: triage.triageByChannelId(),
      nowMs: nowTick(),
    })
  );

  const supportHasMoreWindow = createMemo(
    () =>
      supportSectionMemberIds().size > supportDesk().totalCount &&
      supportWindowLimit() < DEFAULT_MAX_TOTAL_RESOLVED_IDS
  );

  const focusModel = createMemo(() =>
    buildFocusModel({
      channels: channels(),
      supportDesk: supportDesk(),
      currentUserId: userId(),
      teamMemberIds: teamMemberIds(),
      unreadIds: unreadIds(),
      unreadOrMentionedIds: unreadOrMentionedIds(),
      mentionCounts: mentionCounts(),
      mutedIds: mutedIds(),
      triageByChannelId: triage.triageByChannelId(),
      nowMs: nowTick(),
    })
  );

  const sectionSortMap = createMemo<ReadonlyMap<string, SectionSortMode>>(
    () => {
      const map = new Map<string, SectionSortMode>();
      for (const [key, pref] of Object.entries(state.sectionPreferences)) {
        if (!key.startsWith('label:') || !pref?.sort) continue;
        const id = key.slice('label:'.length);
        if (
          pref.sort === 'name' ||
          pref.sort === 'updated_at' ||
          pref.sort === 'viewed_at' ||
          pref.sort === 'created_at'
        ) {
          map.set(id, pref.sort);
        }
      }
      return map;
    }
  );

  const normalizedSectionOrder = createMemo(() =>
    state.sectionOrder
      .filter((key) => key.startsWith('label:'))
      .map((key) => key.slice('label:'.length))
  );

  const placement = createMemo(() =>
    buildBrowsePlacement({
      channels: channels(),
      sections: sections(),
      hiddenTeamSectionIds: hiddenTeamSectionIdSet(),
      expandedLargeSectionIds: new Set(prefs.prefs.expandedLargeSectionIds),
      sectionWindowLimits: effectiveSectionWindowLimits(),
      unreadIds: unreadIds(),
      unreadOrMentionedIds: unreadOrMentionedIds(),
      mentionCounts: mentionCounts(),
      mutedIds: mutedIds(),
      selectedChannelId: selectedChannel()?.id,
      unreadOnly: prefs.prefs.unreadOnly,
      hideMuted: prefs.prefs.hideMuted,
      sectionOrder: normalizedSectionOrder(),
      sectionSortById: sectionSortMap(),
    })
  );

  const dmWindow = createMemo(() =>
    buildDmWindow({
      directMessages: channels().filter(
        (ch) => ch.channelType === 'direct_message'
      ),
      filter: prefs.prefs.dmFilter,
      limit: prefs.prefs.dmWindowLimit,
      expandedAll: prefs.prefs.dmExpandedAll,
      unreadOrMentionedIds: unreadOrMentionedIds(),
      activeCallChannelIds: activeCallChannelIds(),
      mutedIds: mutedIds(),
      selectedChannelId: selectedChannel()?.id,
      unreadOnly: prefs.prefs.unreadOnly,
      hideMuted: prefs.prefs.hideMuted,
      query: dmQuery(),
    })
  );

  const totalUnreadCount = createMemo(() => {
    let count = 0;
    const muted = mutedIds();
    const mentions = mentionCounts();
    for (const id of unreadOrMentionedIds()) {
      if (muted.has(id) && (mentions.get(id) ?? 0) === 0) continue;
      count += 1;
    }
    return count;
  });

  // Label & section actions (reusing native Macro SectionDialog & SectionChannelsPicker)
  const dialogOwner = createMemo(() => {
    userId();
    return owner;
  });
  const labelActions = useChannelLabelActions({
    sectionsEnabled: () => true,
    channelTagsEnabled: () => true,
    labelsAvailable,
    labelsUnavailableReason,
    sharedLabels,
    teamId,
    labels: resolvedLabels,
    channelsById: entityById,
    searchResults: () => [],
    labelDialogOwner: dialogOwner,
    setGroupOpen: setViewGroupOpen,
    setLabelOpen,
  });
  const sectionNotifications = useChannelSectionNotifications({
    enabled: () => true,
    labelsAvailable,
    labels: resolvedLabels,
    favorites,
    dialogOwner,
  });

  // Lazy Quick Switch discovery: ONLY runs while Quick Switch is open,
  // returning at most top-50 directory hits + unjoined team channel hits
  // without converting the entire directory up front.
  const discoverableChannels = createMemo<readonly SidebarChannel[]>(() => {
    if (!quickSwitchOpen()) return [];
    const loadedIds = loadedEntityIds();
    const seen = new Set<string>(loadedIds);
    const results: SidebarChannel[] = [];

    for (const dirRec of searchDirectoryTopK(
      directory.channels(),
      quickSwitchQuery(),
      50,
      loadedIds
    )) {
      seen.add(dirRec.id);
      results.push(toSidebarChannelFromDirectory(dirRec));
    }

    for (const ch of quickSwitchDiscovery.items()) {
      if (seen.has(ch.id)) continue;
      seen.add(ch.id);
      results.push(toSidebarChannel(ch));
    }

    return results;
  });

  const openChannel = (
    channelId: string,
    opts?: { newSplit?: boolean; focusComposer?: boolean }
  ) => {
    const entity =
      entityById().get(channelId) ??
      quickSwitchDiscovery.items().find((ch) => ch.id === channelId);
    const sidebarCh =
      channelsById().get(channelId) ??
      discoverableChannels().find((ch) => ch.id === channelId);
    const fallbackEntity: ChannelEntity | undefined =
      entity ??
      (sidebarCh
        ? {
            id: sidebarCh.id,
            type: 'channel',
            name: sidebarCh.name,
            ownerId: '',
            channelType: sidebarCh.channelType,
            teamId: sidebarCh.teamId,
            isParticipant: sidebarCh.isParticipant,
          }
        : undefined);

    const openViaSplitList = (openInNewSplit: boolean) => {
      if (!fallbackEntity) return;
      fireAndForget(
        openEntityInSplitFromUnifiedList(
          withEntityNotifications(fallbackEntity, notificationSource),
          {
            ...(openInNewSplit ? { openInNewSplit: true } : {}),
            splitHandle: panel.handle,
            referredFrom: 'channels',
            notificationSource,
            channelNavigation: 'latest',
            channelReadScope: 'top-level',
          }
        ),
        'channels-view'
      );
    };

    if (options.openPreview && fallbackEntity && !opts?.newSplit) {
      if (
        !options.openPreview(fallbackEntity) &&
        fallbackEntity.isParticipant === false
      ) {
        openViaSplitList(false);
      }
      return;
    }

    if (opts?.newSplit) {
      openViaSplitList(true);
      return;
    }

    // On narrow touch/mobile layouts where inline preview isn't active,
    // route directly through the unified split opener (same as ChannelsMobileView).
    if (!options.openPreview && mobileLayout()) {
      openViaSplitList(false);
      return;
    }

    const previous = selectedChannel();
    const target = fallbackEntity
      ? getChannelEntityTarget(
          withEntityNotifications(fallbackEntity, notificationSource),
          { channelNavigation: 'latest' }
        )
      : undefined;
    const selection = channelPreviewSelection(channelId, { target });
    if (
      !setSelectedChannel(selection, {
        focusComposer: opts?.focusComposer ?? true,
      })
    ) {
      return;
    }
    if (
      previous?.id === channelId &&
      fallbackEntity &&
      fallbackEntity.isParticipant !== false
    ) {
      markChannelNotificationsSeenOnOpen(
        withEntityNotifications(fallbackEntity, notificationSource),
        notificationSource,
        { channelReadScope: 'top-level' }
      );
      fireAndForget(
        navigateChannelEntityToTarget(selection, orchestrator),
        'channels-view'
      );
    }
  };

  const createSection = async (
    input?: SidebarCreateSectionInput
  ): Promise<string | undefined> => {
    const scope = input?.scope ?? 'personal';
    if (input?.name) {
      const uid = userId();
      const mutation =
        scope === 'team' ? createTeamMutation : createPersonalMutation;
      const created = await mutation.mutateAsync({
        name: input.name,
        channelIds: input.ruleContains ? [] : (input.channelIds ?? []),
        rule: input.ruleContains
          ? { attribute: 'name', contains: input.ruleContains }
          : undefined,
        actorId: uid,
        sectionMode: true,
      });
      setLabelOpen(created.id, true);
      return created.id;
    }
    await labelActions.createLabel(input?.channelIds ?? [], scope);
    return undefined;
  };

  const isLoading = () =>
    options.sources.team_channels.isLoading() &&
    options.sources.channels.isLoading() &&
    options.sources.direct_messages.isLoading();

  const error = () =>
    options.sources.team_channels.error() ??
    options.sources.channels.error() ??
    options.sources.direct_messages.error();

  const retry = () => {
    fireAndForget(
      Promise.all([
        options.sources.team_channels.refresh(),
        options.sources.channels.refresh(),
        options.sources.direct_messages.refresh(),
      ]),
      'channels-view'
    );
  };

  const retryLabels = () => {
    fireAndForget(
      Promise.all([
        teamSectionsQuery.refetch(),
        personalSectionsQuery.refetch(),
      ]),
      'channels-view'
    );
  };

  const renderChannelIcon = (
    channel: SidebarChannel,
    size: 'sm' | 'md' = 'sm'
  ): JSX.Element => {
    const entity = entityById().get(channel.id);
    if (entity) {
      return <ChannelAvatar channel={entity} size={size} />;
    }
    const cls =
      size === 'md' ? 'size-5 text-ink-muted' : 'size-4 text-ink-muted';
    if (channel.isAgentDm) return <RobotIcon class={cls} />;
    if (channel.channelType === 'direct_message')
      return <UserIcon class={cls} />;
    if (channel.channelType === 'private') return <LockIcon class={cls} />;
    return <HashIcon class={cls} />;
  };

  const renderRowContextMenu = (
    channel: SidebarChannel,
    children: JSX.Element
  ): JSX.Element => {
    const isPinned = () => favoriteChannelIds().includes(channel.id);
    const isMuted = () => mutedIds().has(channel.id);
    const isUnread = () => unreadOrMentionedIds().has(channel.id);
    const assignableLabels = () =>
      resolvedLabels().filter((label) => {
        if (label.rule) return false;
        const entity = entityById().get(channel.id);
        return (
          label.channelIds.includes(channel.id) ||
          (entity ? canAssignChannel(entity, label) : label.teamId == null)
        );
      });

    return (
      <ContextMenu>
        <ContextMenuTrigger as="div" class="min-w-0">
          {children}
        </ContextMenuTrigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="min-w-52">
            <MenuGroup>
              <MenuItem
                icon={SplitIcon}
                text={t('channelSidebar.contextOpenInSplit')}
                onClick={() => openChannel(channel.id, { newSplit: true })}
              />
              <Show when={isUnread()}>
                <MenuItem
                  icon={CheckIcon}
                  text={t('channelSidebar.focusMarkRead')}
                  onClick={() =>
                    fireAndForget(
                      markChannelsAsRead([channel.id]),
                      'channels-view'
                    )
                  }
                />
              </Show>
              <MenuItem
                icon={isPinned() ? PushPinSlashIcon : PushPinIcon}
                text={
                  isPinned()
                    ? t('channelSidebar.contextUnpinFromTop')
                    : t('channelSidebar.contextPinToTop')
                }
                onClick={() => {
                  if (isPinned()) {
                    fireAndForget(
                      removeFavorite.mutateAsync({
                        entityType: 'channel',
                        entityId: channel.id,
                      }),
                      'channels-view'
                    );
                  } else {
                    fireAndForget(
                      addFavorite.mutateAsync({
                        entityType: 'channel',
                        entityId: channel.id,
                      }),
                      'channels-view'
                    );
                  }
                }}
              />
              <MenuItem
                icon={isMuted() ? BellIcon : BellSlashIcon}
                text={
                  isMuted()
                    ? t('channelSidebar.contextUnmuteChannel')
                    : t('channelSidebar.contextMuteChannel')
                }
                onClick={() => {
                  const uid = userId();
                  if (!uid) return;
                  fireAndForget(
                    bulkNotificationPrefs.mutateAsync({
                      actorId: uid,
                      items: [{ item_type: 'channel', item_id: channel.id }],
                      muted: !isMuted(),
                    }),
                    'channels-view'
                  );
                }}
              />
            </MenuGroup>

            <Show
              when={
                channel.channelType !== 'direct_message' && labelsAvailable()
              }
            >
              <MenuSeparator />
              <ContextMenu.Sub>
                <SubTrigger
                  icon={TagIcon}
                  text={t('channelSections.addToSection')}
                />
                <ContextMenuContent submenu class="min-w-52">
                  <For each={assignableLabels()}>
                    {(label) => (
                      <MenuItem
                        selectorType="checkbox"
                        checked={label.channelIds.includes(channel.id)}
                        text={label.name}
                        onChange={(checked) =>
                          labelActions.setChannelLabel(
                            channel.id,
                            checked ? label.id : undefined,
                            label.id
                          )
                        }
                      />
                    )}
                  </For>
                  <MenuSeparator />
                  <MenuItem
                    icon={PlusIcon}
                    text={t('channelSections.newSection')}
                    onClick={() =>
                      fireAndForget(
                        labelActions.createLabel([channel.id], 'personal'),
                        'channels-view'
                      )
                    }
                  />
                </ContextMenuContent>
              </ContextMenu.Sub>
            </Show>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    );
  };

  return {
    railId,
    channels,
    channelById: (id) => channelsById().get(id),
    channelEntityById: (id) => entityById().get(id),
    sections,
    rawLabelById: (id) => rawLabelMap().get(id),
    favoriteChannelIds,
    selectedChannelId: () => selectedChannel()?.id,
    teamName,
    teamId,
    teamMemberIds,
    currentUserId: userId,
    unreadIds,
    unreadOrMentionedIds,
    mentionCounts,
    mutedIds,
    activeCallChannelIds,
    incomingCallByChannelId: channelCalls.incomingCallIds,
    isLoading,
    error,
    retry,
    threadsEnabled,
    canShareSections: sharedLabels,
    labelsAvailable,
    labelsFailed,
    labelsUnavailableReason,
    retryLabels,
    prefs,
    triage,
    placement,
    dmWindow,
    dmQuery,
    setDmQuery,
    setQuickSwitchState: (open, query) => {
      setQuickSwitchOpen(open);
      setQuickSwitchQuery(query);
    },
    discoverableChannels,
    supportDesk,
    focusModel,
    totalUnreadCount,
    isGroupOpen: (group: SidebarBuiltInGroup) => state.expandedGroups[group],
    setGroupOpen: (group, open) => setViewGroupOpen(group, open),
    isSectionOpen: (sectionId) => !state.collapsedLabels.includes(sectionId),
    setSectionOpen: (sectionId, open) => setLabelOpen(sectionId, open),
    sectionWindowLimit: (sectionId) =>
      effectiveSectionWindowLimits().get(sectionId),
    loadMoreSection: (sectionId) => {
      setSectionWindowLimits((previous) => {
        const next = new Map(previous);
        const current =
          next.get(sectionId) ??
          (prefs.prefs.expandedLargeSectionIds.includes(sectionId)
            ? LARGE_SECTION_SMART_LIMIT + SECTION_WINDOW_PAGE_STEP
            : LARGE_SECTION_SMART_LIMIT);
        next.set(
          sectionId,
          Math.min(
            current + SECTION_WINDOW_PAGE_STEP,
            DEFAULT_MAX_TOTAL_RESOLVED_IDS
          )
        );
        return next;
      });
    },
    collapseSectionWindow: (sectionId) => {
      setSectionWindowLimits((previous) => {
        if (!previous.has(sectionId)) return previous;
        const next = new Map(previous);
        next.delete(sectionId);
        return next;
      });
      if (prefs.prefs.expandedLargeSectionIds.includes(sectionId)) {
        prefs.toggleLargeSectionExpanded(sectionId);
      }
    },
    loadMoreSupport: () => {
      setSupportWindowLimit((current) =>
        Math.min(
          current + SECTION_WINDOW_PAGE_STEP,
          DEFAULT_MAX_TOTAL_RESOLVED_IDS
        )
      );
    },
    supportHasMoreWindow,
    sectionSort: (sectionId) => sectionSortMap().get(sectionId),
    setSectionSort: (sectionId, sort) => {
      if (sort === 'smart') {
        setSectionPreferences(`label:${sectionId}`, { sort: undefined });
      } else {
        setSectionPreferences(`label:${sectionId}`, { sort });
      }
    },
    sectionOrder: normalizedSectionOrder,
    setSectionOrder: (order) =>
      setViewSectionOrder(
        order.map((id) => `label:${id}` as ChannelSectionKey)
      ),
    openChannel,
    prefetchChannel: (id) => prefetchLatestChannelMessages(id),
    joinChannel: async (channelId) => {
      await joinMutation.mutateAsync({ channelId });
      toast.success('Joined channel');
    },
    markChannelsRead: async (channelIds) => {
      if (channelIds.length === 0) return;
      await markChannelsAsRead(channelIds);
    },
    toggleMuteChannel: async (channelId, muted) => {
      const uid = userId();
      if (!uid) return;
      await bulkNotificationPrefs.mutateAsync({
        actorId: uid,
        items: [{ item_type: 'channel', item_id: channelId }],
        muted,
      });
    },
    toggleFavoriteChannel: async (channelId, pinned) => {
      if (pinned) {
        await addFavorite.mutateAsync({
          entityType: 'channel',
          entityId: channelId,
        });
      } else {
        await removeFavorite.mutateAsync({
          entityType: 'channel',
          entityId: channelId,
        });
      }
    },
    reorderFavorites: async (sourceChannelId, targetChannelId) => {
      const allFavs = favorites();
      const visibleChannelFavs = allFavs.filter(
        (fav) =>
          fav.entityType === 'channel' &&
          Boolean(channelsById().get(fav.entityId))
      );
      const sourceFav = visibleChannelFavs.find(
        (fav) => fav.entityId === sourceChannelId
      );
      const targetFav = visibleChannelFavs.find(
        (fav) => fav.entityId === targetChannelId
      );
      if (!sourceFav || !targetFav) return;
      const reordered = reorderVisibleFavorites(
        allFavs,
        visibleChannelFavs,
        rowKeyForFavorite(sourceFav),
        rowKeyForFavorite(targetFav)
      );
      if (!reordered) return;
      await reorderFavoritesMutation.mutateAsync({
        favorites: reordered.map(({ entityType, entityId }) => ({
          entityType,
          entityId,
        })),
      });
    },
    assignChannelToSection: async (channelId, sectionId, fromSectionId) => {
      const actorId = userId();
      if (!actorId || !labelsAvailable()) return false;
      const to = sectionId ? rawLabelMap().get(sectionId) : undefined;
      const previous = fromSectionId
        ? rawLabelMap().get(fromSectionId)
        : undefined;
      if (sectionId && (!to || to.rule)) return false;

      const entity = entityById().get(channelId);
      const fallbackChannel = channelsById().get(channelId);
      const checkChannel =
        entity ??
        (fallbackChannel
          ? {
              channelType: fallbackChannel.channelType,
              teamId: fallbackChannel.teamId,
              isParticipant: fallbackChannel.isParticipant,
            }
          : undefined);
      if (to && (!checkChannel || !canAssignChannel(checkChannel, to))) {
        return false;
      }

      const scope = to
        ? to.teamId
          ? 'team'
          : 'personal'
        : previous
          ? previous.teamId
            ? 'team'
            : 'personal'
          : 'personal';

      const mutation =
        scope === 'team' ? assignTeamMutation : assignPersonalMutation;
      await mutation.mutateAsync({
        channelId,
        labelId: sectionId,
        actorId,
        sectionMode: true,
      });
      if (sectionId) {
        setLabelOpen(sectionId, true);
      }
      return true;
    },
    createSection,
    editSection: async (sectionId) => {
      const label = rawLabelMap().get(sectionId);
      if (label) await labelActions.renameLabel(label);
    },
    addChannelsToSection: async (sectionId) => {
      const label = rawLabelMap().get(sectionId);
      if (label) await labelActions.addChannelsToLabel(label);
    },
    deleteSection: async (sectionId) => {
      const label = rawLabelMap().get(sectionId);
      if (label) await labelActions.deleteLabel(label);
    },
    markSectionRead: async (sectionId) => {
      await sectionNotifications.markSectionRead(`label:${sectionId}`);
    },
    muteSection: async (sectionId, muted) => {
      await sectionNotifications.muteSection(`label:${sectionId}`, muted);
    },
    openCreateChannel: () => openNewChannelModal(),
    openCreateDm: () => runCreateAction('channel'),
    activeTab: () => (tab() === 'threads' ? 'threads' : 'browse'),
    openThreads: () => setTab('threads'),
    exitThreads: () => setTab('browse'),
    threadsChannelId,
    setThreadsChannelId,
    renderChannelIcon,
    renderLiveCalls: () => <ChannelsLiveCallsSidebar />,
    renderCreateMenu: () => (
      <ConversationsCreateMenu
        presentation="sidebar"
        showCreateSection
        onCreateSection={() =>
          fireAndForget(createSection({ scope: 'personal' }), 'channels-view')
        }
        sectionDisabledReason={
          !labelsAvailable() ? labelsUnavailableReason() : undefined
        }
      />
    ),
    renderRowContextMenu,
    renderHeaderCloseButton: () => <ViewSidebar.CloseButton />,
  };
}
