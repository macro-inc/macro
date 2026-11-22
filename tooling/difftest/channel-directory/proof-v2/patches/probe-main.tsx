// Differential probe, main tree. Mounted inside <QuickAccessProvider> by
// apply-probes.sh; never committed to a PR branch. Every reader expression
// below is copied from the file named beside it, and guards.tsv checks that
// the copied literal still exists in this tree.
import { apiChannelToQuickAccessChannel } from '@core/context/quickAccess/QuickAccessSource';
import { createChannelMentionXML } from '@core/component/LexicalMarkdown/citationsUtils';
import {
  useChannel,
  useChannelActivity,
  useChannelCanCall,
  useChannelName,
  useChannelType,
  useChannelsContext,
  useDmActivityByUserId,
} from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import { formatDate } from '@core/util/date';
import { createFreshSearch, NAME_MATCH_RANKING } from '@core/util/freshSort';
import { getChannelThreadName } from '@entity/utils/channel-thread-name';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { useAvailableSectionChannelsQuery } from '@queries/channel-labels/channel-labels';
import { recordChannelViewWhenIdle } from '@queries/channel/activity';
import { invalidateListChannels } from '@queries/channel/channels';
import { existingDirectMessage } from '@queries/channel/get-or-create-dm';
import { contactUserItem } from '@core/context/quickAccess/person-items';
import { openDirectMessage } from '@core/util/open-direct-message';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { createContactContextSource } from '@queries/contacts/context-source';
import { emailKeys } from '@queries/email/keys';
import { queryReadyGate } from '@queries/gate';
import { ChannelTypeEnum } from '@service-storage/client';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { createRoot, getOwner, runWithOwner } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { botAssignableChannelOptions } from '@app/features/channel/Bots/botChannelOptions';
import { CHANNEL_TABS, DEFAULT_CHANNEL_TAB } from '@app/features/channel/Channel/channel-tabs';
import { groupChatName, isNamedForPeople } from '@app/features/channel/group-chat-name';
import { channelSectionScopeChangeError } from '@app/features/channels-view/core/channel-label-eligibility';
import { fetchChannelGroupIds } from '@app/features/channels-view/queries';
import { useChannelListSearchPool } from '@app/features/channels-view/queries/channel-list-search-pool';
import { findSupportChannelId } from '@app/features/video-tutorials/core/support-channel';
import { createBulkDeleteDssItemsMutation } from '@app/features/entity/queries/dss';
import { createRenameDssEntityMutation } from '@app/features/entity/queries/rename';
import { useAddBotToChannelMutation, useRemoveBotFromChannelMutation } from '@queries/channel/channel-bots';
import { useCreateChannelMutation, usePatchChannelMutation } from '@queries/channel/channels';
import { useGetOrCreateDirectMessageMutation, useGetOrCreatePrivateChannelMutation } from '@queries/channel/get-or-create-dm';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import { useAddParticipantsMutation, useRemoveParticipantsMutation } from '@queries/channel/participants';
import { newMessageId, useSendMessageMutation } from '@queries/messages/mutations';

type Spec = {
  ids?: string[];
  peers?: string[];
  labels?: { channelIds: string[]; teamId?: string; channelCount?: number }[];
  pickerSearch?: string[];
  open?: boolean;
  groups?: boolean;
  rows?: boolean;
  lists?: boolean;
  savedTypes?: (string | null)[];
  facts?: boolean;
};

const PICKER_SEARCH = createFreshSearch<any>({
  // SectionChannelsDialog.tsx searchChannels
  config: { ...NAME_MATCH_RANKING, fuzzyWeight: 1, timeWeight: 0, brevityWeight: 0 },
  getName: (channel) => channel.name ?? '',
  getTimestamp: (channel) => ({ updatedAt: channel.updated_at }),
});

const fallbackName: (() => string | undefined) | undefined = undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ProofProbe() {
  const owner = getOwner();
  const ctx = useChannelsContext();
  const userId = useUserId();
  const account = useQueryAccount();

  // In-app writes: the app's own mutation hooks, called as the UI calls them,
  // so the writing page's read-after-write is what its user sees after acting.
  // Identical in both probes.
  const writers = {
    createChannel: useCreateChannelMutation(),
    patchChannel: usePatchChannelMutation(),
    addParticipants: useAddParticipantsMutation(),
    removeParticipants: useRemoveParticipantsMutation(),
    joinChannel: useJoinChannelMutation(),
    addBot: useAddBotToChannelMutation(),
    removeBot: useRemoveBotFromChannelMutation(),
    getOrCreateDm: useGetOrCreateDirectMessageMutation(),
    getOrCreatePrivate: useGetOrCreatePrivateChannelMutation(),
    rename: createRenameDssEntityMutation(),
    remove: createBulkDeleteDssItemsMutation(),
    send: useSendMessageMutation(),
  };
  const write = async (kind: string, a: any) => {
    const started = performance.now();
    try {
      let created: string | null = null;
      switch (kind) {
        case 'create': {
          const res: any = await writers.createChannel.mutateAsync({
            name: a.name,
            channel_type: a.kind,
            team_id: a.kind === 'team' ? a.team : undefined,
            auto_join_team: a.autoJoin,
            participants: a.participants,
          } as any);
          created = res?.id ?? null;
          break;
        }
        case 'rename': {
          const res: any = await writers.rename.mutateAsync({ entity: { id: a.id, type: 'channel', name: a.oldName ?? '' }, newName: a.name } as any);
          if (res && res.success === false) throw new Error('rename failed');
          break;
        }
        case 'delete': {
          const res: any = await writers.remove.mutateAsync([{ id: a.id, type: 'channel', name: a.oldName ?? '' } as any]);
          if (res && res.success === false) throw new Error(`delete failed: ${JSON.stringify(res).slice(0, 200)}`);
          break;
        }
        case 'add':
          await writers.addParticipants.mutateAsync({ channelId: a.id, participants: a.participants });
          break;
        case 'remove':
          await writers.removeParticipants.mutateAsync({ channelId: a.id, participants: a.participants });
          break;
        case 'join':
          await writers.joinChannel.mutateAsync({ channelId: a.id } as any);
          break;
        case 'botAdd':
        case 'botDm':
          await writers.addBot.mutateAsync({ channelId: a.id, botId: a.bot });
          break;
        case 'botRemove':
          await writers.removeBot.mutateAsync({ channelId: a.id, botId: a.bot });
          break;
        case 'dm': {
          const res: any = await writers.getOrCreateDm.mutateAsync({ recipient_id: a.recipient });
          created = res?.channel_id ?? null;
          break;
        }
        case 'groupDm': {
          const res: any = await writers.getOrCreatePrivate.mutateAsync({ recipients: a.recipients });
          created = res?.channel_id ?? null;
          break;
        }
        case 'message':
          await writers.send.mutateAsync({
            parent: { type: 'channel', id: a.id },
            message: { content: a.content, attachments: [], mentions: [] },
            senderId: userId(),
            optimisticId: newMessageId(),
          } as any);
          break;
        case 'autoJoin':
          await writers.patchChannel.mutateAsync({ channelId: a.id, auto_join_team: a.on } as any);
          break;
        case 'convert':
          await writers.patchChannel.mutateAsync({ channelId: a.id, convert_to_team_channel: a.toTeam } as any);
          break;
        default:
          throw new Error(`no in-app write for ${kind}`);
      }
      return { status: 200, created, ms: performance.now() - started };
    } catch (error) {
      return { status: 'error', error: String((error as any)?.message ?? error).slice(0, 300), ms: performance.now() - started };
    }
  };

  const inRoot = <T,>(fn: () => T): T =>
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        try {
          return fn();
        } finally {
          dispose();
        }
      })
    ) as T;

  const listState = () => {
    const current = account();
    if (!current) return undefined;
    return queryClient.getQueryState(
      channelKeys.listChannels(current.userId).queryKey
    );
  };
  const activityState = () => {
    const current = account();
    if (!current) return undefined;
    return queryClient.getQueryState(
      channelKeys.activity(current.userId).queryKey
    );
  };
  const ready = () =>
    listState()?.status === 'success' &&
    activityState()?.status === 'success' &&
    !ctx.isLoading();

  const perId = (id: string, spec: Spec) =>
    inRoot(() => {
      const channel = useChannel(id);
      const canCall = useChannelCanCall(id);
      const channelName = useChannelName(id);
      const nameFallback = useChannelName(id, 'Channel');
      const channelType = useChannelType(id);
      const activity = useChannelActivity(id);
      const viewer = userId();
      // Channel.tsx inputPlaceholderName / inputPlaceholder
      const inputPlaceholderName = () => {
        const name = channelName();
        if (!name) return undefined;
        if (channel()?.agent_dm) return name;
        if (channelType() === ChannelTypeEnum.Private && isNamedForPeople(name)) {
          return groupChatName(name);
        }
        if (channelType() !== ChannelTypeEnum.DirectMessage) return `#${name}`;
        const parts = name.split(' ');
        return parts.length === 2 && !parts[0]?.endsWith(',') ? parts[0] : name;
      };
      const inputPlaceholder = () => {
        const name = inputPlaceholderName();
        if (channel()?.agent_dm) return `Message ${name ?? 'agent'}`;
        return name ? `Type @ to share with ${name}` : 'Type @ to share';
      };
      const ch = channel();
      // NewChannelBlockAdapter.tsx channelEntity (without the participants query)
      const blockMeta = ch
        ? {
            name: ch.name ?? 'New Channel',
            channelType: ch.channel_type,
            teamId: ch.team_id ?? undefined,
            ownerId: ch.owner_id,
          }
        : undefined;
      // NewChannelBlockAdapter.tsx / ChannelDetail.tsx tab redirect
      const redirect = (tab: string) =>
        channel()?.agent_dm && ['call', 'calls', 'participants'].includes(tab)
          ? DEFAULT_CHANNEL_TAB
          : tab;
      // use-channel-tab-items.tsx availableTabs, with showCallTab's call
      // state given as `callActive`
      const tabs = (callActive: boolean) => {
        const showCallTab = () => ENABLE_CALLS && !channel()?.agent_dm && callActive;
        let filtered = [...CHANNEL_TABS];
        if (channelType() === ChannelTypeEnum.DirectMessage)
          filtered = filtered.filter((tab) => tab.value !== 'participants');
        if (!ENABLE_CALLS || channel()?.agent_dm)
          filtered = filtered.filter((tab) => tab.value !== 'calls');
        if (!showCallTab()) filtered = filtered.filter((tab) => tab.value !== 'call');
        return filtered.map((tab) => tab.value);
      };
      // channel-ask-macro.tsx
      const askMacro = (() => {
        const found = ctx.channelsById()[id];
        if (!found) return undefined;
        return {
          type: 'channel' as const,
          id,
          name: found.name ?? fallbackName?.() ?? 'New Channel',
          channelType: found.channel_type,
        };
      })();
      // ChannelCreatedIndicator.tsx
      const created = (() => {
        const c = channel();
        const show =
          !!c && !!c.name && c.channel_type !== ChannelTypeEnum.DirectMessage;
        return { show, date: show && c ? formatDate(c.created_at, { showTime: true }) : null };
      })();
      // channel-icon.tsx DirectMessageIcon participantId (no participantIds prop)
      const dmIconPeer = (() => {
        const participants =
          channel()?.participants.map((participant) => participant.user_id) ?? [];
        return participants.find((pid) => pid !== viewer) ?? participants[0];
      })();
      // MutedItemRow.tsx useMutedChannelDmRecipientId
      const mutedRecipient = (() => {
        const c = ctx.channelsById()[id];
        if (c?.channel_type !== 'direct_message') return undefined;
        const recipient =
          c.participants.find((p) => p.user_id !== viewer) ?? c.participants[0];
        return recipient?.user_id;
      })();
      // FavoriteIcon.tsx FavoriteChannelIcon
      const favorite = (spec.savedTypes ?? [null, 'public', 'direct_message', 'bogus']).map(
        (saved) => ({
          saved,
          channelType: ctx.channelsById()[id]?.channel_type ?? saved,
          name: ctx.channelsById()[id]?.name ?? undefined,
        })
      );
      const channelsById = ctx.channelsById();
      // HomeList / InboxListEntity / condensed-notification-row
      const threadEntity = {
        channelId: id,
        threadId: 'proof-thread',
        notifications: () => [
          {
            entity_type: 'channel',
            entity_id: id,
            notification_metadata: {
              tag: 'channel_message_send',
              content: { messageId: 'proof-thread', channelName: 'Notified name' },
            },
          },
        ],
      } as any;
      // use-start-channel-call.tsx participantIds
      const startCallIds = [
        ...(viewer ? [viewer] : []),
        ...(channel()?.participants ?? [])
          .filter((participant) => participant.user_id !== viewer)
          .map((participant) => participant.user_id),
      ];
      // live-calls-sidebar.tsx
      const liveCall = (() => {
        const found = channelsById[id];
        if (!found) return null;
        return { label: found.name ?? 'Channel call' };
      })();
      return {
        present: ch !== undefined,
        canCall: canCall(),
        name: channelName() ?? null,
        nameFallback: nameFallback() ?? null,
        type: channelType() ?? null,
        // Channel.tsx createActivityTracker lastViewedAt
        lastViewedAt: activity()?.viewed_at ?? null,
        placeholderName: inputPlaceholderName() ?? null,
        placeholder: inputPlaceholder(),
        hasAgents: !!channel()?.agent_dm,
        dmEmptyState:
          channelType() === ChannelTypeEnum.DirectMessage && !channel()?.agent_dm,
        hideTriggeredBy: !!channel()?.agent_dm,
        composerBotId: channel()?.agent_dm?.bot_id ?? null,
        blockMeta: blockMeta ?? null,
        agentBotId: channel()?.agent_dm?.bot_id ?? null,
        // call.isInThisChannel() false
        callButton: ENABLE_CALLS && !channel()?.agent_dm && !false,
        tabRedirect: ['messages', 'call', 'calls', 'participants'].map(redirect),
        tabs: { idle: tabs(false), callActive: tabs(true) },
        // ChannelDetail.tsx participantIds
        detailMemberIds:
          channel()?.participants.map((participant) => participant.user_id) ?? [],
        startCallIds,
        askMacro: askMacro ?? null,
        created,
        // ChannelParticipantsTab.tsx
        autoJoin: channel()?.auto_join_team ?? false,
        dmIconPeer: dmIconPeer ?? null,
        mutedRecipient: mutedRecipient ?? null,
        favorite,
        // channel-icon.tsx ChannelIcon: the DM icon only for direct_message
        favoriteIcon: favorite.map((f) => (f.channelType === 'direct_message' ? 'dm' : 'channel')),
        // BotDetailPage.tsx assignedChannels name
        botAssignedName:
          channelsById[id]?.name?.trim() || 'Bot list name'.trim() || 'Unnamed channel',
        // CallContext.tsx channelTitle
        callTitle: channelsById[id]?.name ?? null,
        // CallStartedNotifier.tsx channelName
        notifierName: channelsById[id]?.name ?? null,
        // incoming-calls.ts useVisibleIncomingCalls
        incomingVisible: !!channelsById[id],
        liveCall,
        // slack-import.tsx channelHref
        slackHref: !channelsById[id] ? null : `/app/channel/${encodeURIComponent(id)}`,
        threadName: getChannelThreadName(threadEntity, channelsById),
        // use-callkit.ts listedChannel
        callkitName: channelsById[id] ? { name: channelsById[id].name } : null,
        citation: createChannelMentionXML(id),
      };
    });

  const lists = (spec: Spec) =>
    inRoot(() => {
      const channels = ctx.channels();
      const viewer = userId();
      const dmActivity = useDmActivityByUserId();
      const pool = useChannelListSearchPool();
      const groups = channels
        .filter((channel) => channel.participants.length > 2)
        .map(recipientEntityMapper('channel'));
      return {
        order: channels.map((channel) => channel.id),
        dmActivity: [...dmActivity().entries()],
        // person-items.ts contactUserItem: what every reader sorts the DM time by
        dmActivitySort: [...dmActivity().entries()].map(([id, at]) => [
          id,
          contactUserItem({ id, name: '', email: '', lastInteraction: at } as any).sortTimestamp,
        ]),
        quickAccessBase: channels.map((channel) => apiChannelToQuickAccessChannel(channel)),
        quickAccessLoading: ctx.isLoading(),
        // recipient-source.ts groups
        recipients: groups.map((entity) => ({ kind: entity.kind, id: entity.id })),
        // universal-input/actions.ts messageChannels
        universalInput: channels
          .filter((channel) => channel.participants.length > 2)
          .map(recipientEntityMapper('channel'))
          .map((entity) => ({ kind: entity.kind, id: entity.id })),
        // search.ts useSearchSoupQuery channelMetadata, transform-utils mapper input
        searchMetadata: channels.map(({ id, name, team_id }) => ({ id, name, team_id })),
        // search.ts useSearchChannelQuery channelNames
        searchNames: channels.map(({ id, name }) => ({ id, name })),
        searchPool: pool(),
        // create-support-link.ts
        supportId: ctx.isLoading() ? undefined : findSupportChannelId(channels, viewer) ?? null,
        // Agents.tsx / ChannelMultiSelect.tsx / BotCreatePage.tsx
        botOptions: botAssignableChannelOptions(channels),
        spec: spec.ids?.length ?? 0,
      };
    });

  // The local stack has no inboxes; both trees get the same empty links
  // answer, so the facts differ only by their channel inputs.
  const seedLinks = () => {
    const current = account();
    if (!current) return false;
    const key = emailKeys.links(current.userId).queryKey;
    if (queryClient.getQueryState(key)?.status === 'success') return false;
    queryClient.setQueryData(key, { links: [] });
    return true;
  };

  const contextFacts = async (timeoutMs: number) => {
    const seeded = seedLinks();
    const holder: { dispose?: () => void; read?: () => unknown } = {};
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        holder.dispose = dispose;
        const facts = createContactContextSource({
          account,
          host: () => getGraphqlSoupCacheHost(),
          generation: () => 0,
          enabled: () => true,
        });
        holder.read = facts;
      })
    );
    const started = Date.now();
    try {
      for (;;) {
        const value = holder.read?.() as Map<string, unknown> | undefined;
        if (value) return { seeded, facts: [...value.entries()] };
        if (Date.now() - started > timeoutMs) return 'timeout';
        await sleep(100);
      }
    } finally {
      holder.dispose?.();
    }
  };

  const openSnapshot = async (spec: Spec) => {
    const holder: { dispose?: () => void; query?: any } = {};
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        holder.dispose = dispose;
        holder.query = useAvailableSectionChannelsQuery();
      })
    );
    const started = Date.now();
    try {
      while (holder.query.isPending || holder.query.isFetching) {
        if (Date.now() - started > 30_000) break;
        await sleep(50);
      }
      const query = holder.query;
      const data: any[] = query.isPending ? [] : unwrap(query.data ?? []);
      const labels = spec.labels ?? [];
      // SectionChannelsDialog.tsx available
      const available = (label: { channelIds: string[]; teamId?: string }) => {
        if (query.isPending) return [];
        return data
          .filter((channel) => {
            if (!channel.is_participant || label.channelIds.includes(channel.id)) return false;
            if (label.teamId) {
              return channel.channel_type === 'team' && channel.team_id === label.teamId;
            }
            return (
              channel.channel_type === 'team' ||
              channel.channel_type === 'public' ||
              channel.channel_type === 'private'
            );
          })
          .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
      };
      const picker = labels.map((label) => {
        const rows = available(label);
        return {
          ids: rows.map((row) => row.id),
          busy: query.isPending,
          search: (spec.pickerSearch ?? []).map((term) =>
            PICKER_SEARCH(rows, term).map((result) => result.item.id)
          ),
        };
      });
      // ChannelMuteMenu.tsx SectionMuteMenu ids, built-in sections
      const mute = ['team_channels', 'direct_messages', 'channels'].map((section) => {
        const ids = !queryReadyGate(query)
          ? []
          : data
              .filter((channel) => {
                if (!channel.is_participant) return false;
                if (section === 'team_channels') return channel.channel_type === 'team';
                if (section === 'direct_messages')
                  return channel.channel_type === 'direct_message';
                return (
                  channel.channel_type !== 'team' &&
                  channel.channel_type !== 'direct_message'
                );
              })
              .map((channel) => channel.id);
        return { section, ids, disabled: false };
      });
      // SectionDialog.tsx channelsById / scopeChangeError
      const channelsById = new Map(
        (query.isPending ? [] : data).map((channel) => [
          channel.id,
          {
            channelType: channel.channel_type,
            teamId: channel.team_id ?? undefined,
            isParticipant: channel.is_participant,
          },
        ])
      );
      const dialog = labels.map((label) => {
        const initial = { channelIds: label.channelIds, channelCount: label.channelCount ?? label.channelIds.length };
        const reason = (teamId: string | undefined) => {
          if (initial.channelCount > 0 && query.isPending) return 'checkingSharing';
          if (initial.channelCount > 0 && query.isError) return 'channelsUnavailable';
          return channelSectionScopeChangeError(initial, channelsById, { teamId }) ?? null;
        };
        return { toTeam: reason(label.teamId), toPersonal: reason(undefined) };
      });
      const groupIds: Record<string, string[] | string> = {};
      if (spec.groups !== false) {
        for (const group of ['team_channels', 'channels', 'direct_messages'] as const) {
          try {
            // useChannelSectionNotifications.ts channelIdsFor
            groupIds[group] = await fetchChannelGroupIds(group, []);
          } catch (error) {
            groupIds[group] = `error:${String(error)}`;
          }
        }
      }
      return { picker, mute, dialog, groupIds };
    } finally {
      holder.dispose?.();
    }
  };

  const snapshot = async (spec: Spec = {}) => {
    const at = Date.now();
    const ids = spec.ids ?? [];
    const rows = spec.rows === false ? undefined : unwrap(ctx.channels());
    const activity: Record<string, string | null> = {};
    for (const row of ctx.activity()) activity[row.channel_id] = row.viewed_at ?? null;
    const perIdOut: Record<string, unknown> = {};
    for (const id of ids) perIdOut[id] = perId(id, spec);
    const citations: Record<string, string> = {};
    for (const id of ids) citations[id] = String(await (perIdOut[id] as any).citation);
    for (const id of ids) (perIdOut[id] as any).citation = citations[id];
    const dm: Record<string, string | null> = {};
    for (const peer of spec.peers ?? []) {
      const viewer = userId();
      if (!viewer) continue;
      const result = await existingDirectMessage(viewer, peer);
      dm[peer] = result.isOk() ? (result.value ?? null) : 'error';
    }
    // open-direct-message.ts openDirectMessage: what opening the person does
    const dmOpen: Record<string, unknown> = {};
    for (const peer of spec.peers ?? []) {
      let opened: unknown = "skipped";
      await openDirectMessage(userId(), peer, (content, existing) => {
        // A pending DM id is random per page; what matters is that it is pending.
        opened = { existing, id: existing ? (content as { id: string }).id : "pending" };
      });
      dmOpen[peer] = opened;
    }
    return {
      tree: 'main',
      mode: 'rest',
      ready: ready(),
      at,
      rows,
      activity,
      perId: perIdOut,
      lists: spec.lists === false ? undefined : lists(spec),
      facts: spec.facts ? await contextFacts(20_000) : undefined,
      open: spec.open ? await openSnapshot(spec) : undefined,
      dm,
      dmOpen,
      tookMs: Date.now() - at,
    };
  };

  (window as any).__proof = {
    tree: 'main',
    mode: () => 'rest',
    ready,
    waitReady: async (timeoutMs = 120_000) => {
      const started = Date.now();
      while (!ready()) {
        if (Date.now() - started > timeoutMs) return false;
        await sleep(100);
      }
      return true;
    },
    snapshot,
    // What main's mutation hooks run on settle.
    refresh: () => invalidateListChannels(),
    recordView: (channelId: string) => recordChannelViewWhenIdle(channelId),
    write,
    userId: () => userId(),
  };
  return null;
}
