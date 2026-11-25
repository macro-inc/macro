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
import type { DirectoryChannel } from '@queries/channel/directory-core';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import {
  useChannelSectionsQuery,
  useCreateChannelLabelMutation,
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
import { useChannelCalls } from '../../components/rail/hooks/useChannelCalls';
import { useChannelLabelActions } from '../../components/rail/hooks/useChannelLabelActions';
import { useChannelRailActivity } from '../../components/rail/hooks/useChannelRailActivity';
import { useChannelSectionNotifications } from '../../components/rail/hooks/useChannelSectionNotifications';
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
import type { SidebarChannel, SidebarSection } from '../core/sidebar-model';
import { toEpochMs } from '../core/sidebar-model';
import { buildSupportDeskModel } from '../core/support-triage';
import { toSidebarChannel, toSidebarSection } from '../queries/adapt-channel';
import { liveJevDecide } from '../queries/jev-decide';
import { createJevTriageController } from './create-jev-triage';
import { createSidebarPreferences } from './create-sidebar-preferences';

function directoryOnlyToSidebarChannel(
  record: DirectoryChannel
): SidebarChannel {
  const latest = record.latestNonThreadMessage;
  return {
    id: record.id,
    name: record.agentDm?.name ?? record.name ?? 'Unnamed channel',
    channelType: record.channelType,
    teamId: record.teamId ?? undefined,
    isParticipant: record.isParticipant,
    updatedAtMs: toEpochMs(record.updatedAt),
    viewedAtMs: toEpochMs(record.viewedAt),
    createdAtMs: toEpochMs(record.createdAt),
    frecencyScore: record.frecencyScore ?? 0,
    participantIds: record.participants
      .filter((p) => p.leftAt === null)
      .map((p) => p.userId),
    botParticipantIds: record.botParticipants
      .filter((p) => p.leftAt === null)
      .map((p) => p.botId),
    isAgentDm: Boolean(record.agentDm),
    latestMessage: latest
      ? {
          messageId: latest.messageId,
          senderId: latest.senderId,
          content: latest.content,
          createdAtMs: toEpochMs(latest.createdAt),
          threadId: latest.threadId ?? undefined,
          mentions: latest.mentions,
        }
      : undefined,
  };
}

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
  const teamQuery = useCurrentTeamQuery();
  const {
    state,
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

  const favoritesData = useFavoritesData({ entityType: ['channel'] });
  const addFavorite = useAddFavoriteMutation();
  const removeFavorite = useRemoveFavoriteMutation();
  const reorderFavoritesMutation = useReorderFavoritesMutation();
  const joinMutation = useJoinChannelMutation();
  const bulkNotificationPrefs = useBulkNotificationPreferencesMutation();

  const favorites = createMemo(() => favoritesData()?.favorites ?? []);
  const favoriteChannelIds = createMemo(() =>
    favorites()
      .filter((fav) => fav.entityType === 'channel')
      .map((fav) => fav.entityId)
  );

  // Combine all loaded ChannelEntity rows across scopes
  const loadedEntities = createMemo(() =>
    deduplicateChannels([
      options.sources.team_channels.items(),
      options.sources.channels.items(),
      options.sources.direct_messages.items(),
      options.sources.recents.items(),
      options.localChannels(),
    ])
  );

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

  // Resolve channels referenced by favorites or manual sections that aren't in loaded pages
  const missingReferencedIds = createMemo(() => {
    const loadedIds = new Set(loadedEntities().map((ch) => ch.id));
    const refs = new Set([
      ...rawLabelsUnresolved().flatMap((l) => l.channelIds),
      ...favoriteChannelIds(),
    ]);
    return [...refs].filter((id) => !loadedIds.has(id));
  });
  const referencedChannels = useCachedChannelsByIds(
    missingReferencedIds,
    () => true
  );

  const allEntities = createMemo(() =>
    deduplicateChannels([loadedEntities(), referencedChannels.channels()])
  );
  const entityById = createMemo(
    () => new Map(allEntities().map((ch) => [ch.id, ch]))
  );
  const directoryById = createMemo(
    () => new Map(directory.channels().map((ch) => [ch.id, ch]))
  );

  // Merge ChannelEntities + DirectoryChannels into unified SidebarChannel records
  const channels = createMemo<SidebarChannel[]>(() => {
    const seen = new Set<string>();
    const list: SidebarChannel[] = [];

    for (const entity of allEntities()) {
      seen.add(entity.id);
      list.push(toSidebarChannel(entity, directoryById().get(entity.id)));
    }
    for (const dirRec of directory.channels()) {
      if (seen.has(dirRec.id)) continue;
      seen.add(dirRec.id);
      list.push(directoryOnlyToSidebarChannel(dirRec));
    }
    return list;
  });

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

  // Support Desk + Jev Triage Controller
  const supportChannelIds = createMemo<ReadonlySet<string>>(() => {
    const desk = buildSupportDeskModel({
      channels: channels(),
      sections: sections(),
      currentUserId: userId(),
      teamMemberIds: teamMemberIds(),
      unreadIds: unreadIds(),
      mentionCounts: mentionCounts(),
      triageByChannelId: new Map(),
      nowMs: nowTick(),
    });
    return new Set(desk.items.map((item) => item.channel.id));
  });

  const triage = createJevTriageController({
    accountKey: () =>
      userId() ? `${userId()}:${queryAccountSession()}` : undefined,
    userId,
    enabled: () => prefs.prefs.jevEnabled,
    channels,
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
      hiddenTeamSectionIds: new Set(prefs.prefs.hiddenTeamSectionIds),
      expandedLargeSectionIds: new Set(prefs.prefs.expandedLargeSectionIds),
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

  const openChannel = (
    channelId: string,
    opts?: { newSplit?: boolean; focusComposer?: boolean }
  ) => {
    const entity = entityById().get(channelId);
    if (options.openPreview && entity && !opts?.newSplit) {
      options.openPreview(entity);
      return;
    }
    if (opts?.newSplit && entity) {
      fireAndForget(
        openEntityInSplitFromUnifiedList(
          withEntityNotifications(entity, notificationSource),
          {
            openInNewSplit: true,
            referredFrom: 'channels',
            notificationSource,
            channelNavigation: 'latest',
            channelReadScope: 'top-level',
          }
        ),
        'channels-view'
      );
      return;
    }
    const previous = selectedChannel();
    const target = entity
      ? getChannelEntityTarget(
          withEntityNotifications(entity, notificationSource),
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
      entity &&
      entity.isParticipant !== false
    ) {
      markChannelNotificationsSeenOnOpen(
        withEntityNotifications(entity, notificationSource),
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
    supportDesk,
    focusModel,
    totalUnreadCount,
    isGroupOpen: (group: SidebarBuiltInGroup) => state.expandedGroups[group],
    setGroupOpen: (group, open) => setViewGroupOpen(group, open),
    isSectionOpen: (sectionId) => !state.collapsedLabels.includes(sectionId),
    setSectionOpen: (sectionId, open) => setLabelOpen(sectionId, open),
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
      const current = favorites();
      const channelFavs = current.filter((f) => f.entityType === 'channel');
      const srcIdx = channelFavs.findIndex(
        (f) => f.entityId === sourceChannelId
      );
      const dstIdx = channelFavs.findIndex(
        (f) => f.entityId === targetChannelId
      );
      if (srcIdx < 0 || dstIdx < 0 || srcIdx === dstIdx) return;
      const next = [...channelFavs];
      next.splice(dstIdx, 0, ...next.splice(srcIdx, 1));
      await reorderFavoritesMutation.mutateAsync({
        favorites: next.map(({ entityType, entityId }) => ({
          entityType,
          entityId,
        })),
      });
    },
    assignChannelToSection: async (channelId, sectionId, fromSectionId) => {
      labelActions.setChannelLabel(channelId, sectionId, fromSectionId);
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
