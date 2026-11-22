// Differential probe, branch tree. Mounted inside <QuickAccessProvider> by
// apply-probes.sh; never committed to a PR branch. Every reader expression
// below is copied from the file named beside it, and guards.tsv checks that
// the copied literal still exists in this tree.
import { apiChannelToQuickAccessChannel } from '@core/context/quickAccess/QuickAccessSource';
import { createChannelMentionXML } from '@core/component/LexicalMarkdown/citationsUtils';
import {
  channelMemberIds,
  knownLastView,
  LAST_VIEW_WAIT_MS,
  useChannelLastViewed,
  directMessagePeer,
  loadedChannel,
  useChannel,
  useChannelCanCall,
  useChannelDirectory,
  useChannelName,
  useChannelType,
  useDmActivityByUserId,
} from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { ENABLE_CALLS, ENABLE_GRAPHQL_BACKFILL } from '@core/constant/featureFlags';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import { formatDate } from '@core/util/date';
import { createFreshSearch, NAME_MATCH_RANKING } from '@core/util/freshSort';
import { getChannelThreadName } from '@entity/utils/channel-thread-name';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { recordChannelViewWhenIdle } from '@queries/channel/activity';
import { refreshChannelDirectory, settledChannelLookup } from '@queries/channel/directory';
import { toChannelListItem } from '@queries/channel/directory-core';
import { existingDirectMessage } from '@queries/channel/get-or-create-dm';
import { contactUserItem } from '@core/context/quickAccess/person-items';
import { openDirectMessage } from '@core/util/open-direct-message';
import { queryClient } from '@queries/client';
import { createContactContextSource } from '@queries/contacts/context-source';
import { emailKeys } from '@queries/email/keys';
import { channelSearchMetadata } from '@queries/soup/transform-utils';
import { ChannelTypeEnum } from '@service-storage/client';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';
import { createRoot, getOwner, runWithOwner } from 'solid-js';
import { botAssignableChannelOptions } from '@app/features/channel/Bots/botChannelOptions';
import { CHANNEL_TABS, DEFAULT_CHANNEL_TAB } from '@app/features/channel/Channel/channel-tabs';
import { groupChatName, isNamedForPeople } from '@app/features/channel/group-chat-name';
import { channelSectionScopeChangeError } from '@app/features/channels-view/core/channel-label-eligibility';
import { channelGroupIds } from '@app/features/channels-view/queries';
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
  lookupWaitMs?: number;
};

const PICKER_SEARCH = createFreshSearch<any>({
  // SectionChannelsDialog.tsx searchChannels
  config: { ...NAME_MATCH_RANKING, fuzzyWeight: 1, timeWeight: 0, brevityWeight: 0 },
  getName: (channel) => channel.name ?? '',
  getTimestamp: (channel) => ({ updatedAt: channel.updatedAt }),
});

// FavoriteIcon.tsx savedChannelType
function savedChannelType(value: string | null | undefined) {
  return match(value)
    .with('public', 'private', 'team', 'direct_message', (type) => type)
    .otherwise(() => undefined);
}

const fallbackName: (() => string | undefined) | undefined = undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ProofProbe() {
  const owner = getOwner();
  const directory = useChannelDirectory();
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

  const mode = () => {
    const current = getGraphqlSoupCacheHost();
    return current && !current.disabled && ENABLE_GRAPHQL_BACKFILL ? 'cache' : 'memory';
  };
  const ready = () => directory.complete();

  const perId = (id: string, spec: Spec) =>
    inRoot(() => {
      const channel = useChannel(id);
      const canCall = useChannelCanCall(id);
      const channelName = useChannelName(id);
      const nameFallback = useChannelName(id, 'Channel');
      const channelType = useChannelType(id);
      const viewer = userId();
      const lookup = directory.lookup(id);
      // Channel.tsx inputPlaceholderName / inputPlaceholder
      const inputPlaceholderName = () => {
        const name = channelName();
        if (!name) return undefined;
        if (channel()?.agentDm) return name;
        if (channelType() === ChannelTypeEnum.Private && isNamedForPeople(name)) {
          return groupChatName(name);
        }
        if (channelType() !== ChannelTypeEnum.DirectMessage) return `#${name}`;
        const parts = name.split(' ');
        return parts.length === 2 && !parts[0]?.endsWith(',') ? parts[0] : name;
      };
      const inputPlaceholder = () => {
        const name = inputPlaceholderName();
        if (channel()?.agentDm) return `Message ${name ?? 'agent'}`;
        return name ? `Type @ to share with ${name}` : 'Type @ to share';
      };
      const ch = channel();
      // NewChannelBlockAdapter.tsx channelEntity (without the participants query)
      const blockMeta = ch
        ? {
            name: ch.name ?? 'New Channel',
            channelType: ch.channelType,
            teamId: ch.teamId ?? undefined,
            ownerId: ch.ownerId,
          }
        : undefined;
      // NewChannelBlockAdapter.tsx / ChannelDetail.tsx tab redirect
      const redirect = (tab: string) =>
        channel()?.agentDm && ['call', 'calls', 'participants'].includes(tab)
          ? DEFAULT_CHANNEL_TAB
          : tab;
      // use-channel-tab-items.tsx availableTabs, with showCallTab's call
      // state given as `callActive`
      const tabs = (callActive: boolean) => {
        const showCallTab = () => ENABLE_CALLS && !channel()?.agentDm && callActive;
        let filtered = [...CHANNEL_TABS];
        if (channelType() === ChannelTypeEnum.DirectMessage)
          filtered = filtered.filter((tab) => tab.value !== 'participants');
        if (!ENABLE_CALLS || channel()?.agentDm)
          filtered = filtered.filter((tab) => tab.value !== 'calls');
        if (!showCallTab()) filtered = filtered.filter((tab) => tab.value !== 'call');
        return filtered.map((tab) => tab.value);
      };
      // channel-ask-macro.tsx
      const askMacro = (() => {
        const current = channel();
        if (!current) return undefined;
        return {
          type: 'channel' as const,
          id: current.id,
          name: current.name ?? fallbackName?.() ?? 'New Channel',
          channelType: current.channelType,
        };
      })();
      // ChannelCreatedIndicator.tsx
      const created = (() => {
        const c = channel();
        const show = !!c && !!c.name && c.channelType !== 'direct_message';
        return { show, date: show && c ? formatDate(c.createdAt, { showTime: true }) : null };
      })();
      // channel-icon.tsx DirectMessageIcon participantId (no participantIds prop)
      const dmIconPeer = (() => {
        const current = channel();
        if (!current) return undefined;
        return directMessagePeer(current, viewer) ?? current.participants[0]?.userId;
      })();
      // MutedItemRow.tsx useMutedChannelDmRecipientId
      const mutedRecipient = (() => {
        if (lookup.status !== 'loaded') return undefined;
        const c = lookup.channel;
        if (c.channelType !== 'direct_message') return undefined;
        return directMessagePeer(c, viewer) ?? c.participants[0]?.userId;
      })();
      // FavoriteIcon.tsx FavoriteChannelIcon
      const favorite = (spec.savedTypes ?? [null, 'public', 'direct_message', 'bogus']).map(
        (saved) => ({
          saved,
          channelType: channel()?.channelType ?? savedChannelType(saved),
          name: channel()?.name ?? undefined,
        })
      );
      const current = loadedChannel(lookup);
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
        ...(ch ? channelMemberIds(ch) : []).filter((pid) => pid !== viewer),
      ];
      // live-calls-sidebar.tsx
      const liveCall = lookup.status !== 'loaded' ? null : { label: lookup.channel.name ?? 'Channel call' };
      return {
        present: ch !== undefined,
        lookup: lookup.status,
        canCall: canCall(),
        name: channelName() ?? null,
        nameFallback: nameFallback() ?? null,
        type: channelType() ?? null,
        // Channel.tsx createActivityTracker lastViewedAt: filled in by lastViewedOf
        lastViewedAt: null as string | null | undefined,
        placeholderName: inputPlaceholderName() ?? null,
        placeholder: inputPlaceholder(),
        hasAgents: !!channel()?.agentDm,
        dmEmptyState:
          channelType() === ChannelTypeEnum.DirectMessage && !channel()?.agentDm,
        hideTriggeredBy: !!channel()?.agentDm,
        composerBotId: channel()?.agentDm?.botId ?? null,
        blockMeta: blockMeta ?? null,
        agentBotId: channel()?.agentDm?.botId ?? null,
        // call.isInThisChannel() false
        callButton: ENABLE_CALLS && !channel()?.agentDm && !false,
        tabRedirect: ['messages', 'call', 'calls', 'participants'].map(redirect),
        tabs: { idle: tabs(false), callActive: tabs(true) },
        // ChannelDetail.tsx memberIds
        detailMemberIds: ch ? channelMemberIds(ch) : [],
        startCallIds,
        askMacro: askMacro ?? null,
        created,
        // ChannelParticipantsTab.tsx
        autoJoin: channel()?.autoJoinTeam ?? false,
        dmIconPeer: dmIconPeer ?? null,
        mutedRecipient: mutedRecipient ?? null,
        favorite,
        // channel-icon.tsx ChannelIcon: the DM icon only for direct_message
        favoriteIcon: favorite.map((f) => (f.channelType === 'direct_message' ? 'dm' : 'channel')),
        // BotDetailPage.tsx assignedChannels name
        botAssignedName:
          loadedChannel(directory.lookup(id))?.name?.trim() ||
          'Bot list name'.trim() ||
          'Unnamed channel',
        // CallContext.tsx channelTitle
        callTitle: loadedChannel(directory.lookup(id))?.name ?? null,
        // CallStartedNotifier.tsx channelName
        notifierName: loadedChannel(directory.lookup(id))?.name ?? null,
        // incoming-calls.ts useVisibleIncomingCalls
        incomingVisible: directory.lookup(id).status === 'loaded',
        liveCall,
        // slack-import.tsx channelHref
        slackHref:
          directory.lookup(id).status !== 'loaded' ? null : `/app/channel/${encodeURIComponent(id)}`,
        threadName: getChannelThreadName(threadEntity, current ? { [current.id]: current } : {}),
        // use-callkit.ts listedChannel
        callkitName: current ? { name: current.name } : null,
        citation: createChannelMentionXML(id),
      };
    });

  const lists = (spec: Spec) =>
    inRoot(() => {
      const channels = directory.channels();
      const viewer = userId();
      const dmActivity = useDmActivityByUserId();
      const pool = useChannelListSearchPool();
      const groups = channels
        .filter((channel) => channel.participants.length + channel.botParticipants.length > 2)
        .map((channel) => recipientEntityMapper('channel')(toChannelListItem(channel)));
      return {
        order: channels.map((channel) => channel.id),
        dmActivity: [...dmActivity().entries()],
        // person-items.ts contactUserItem: what every reader sorts the DM time by
        dmActivitySort: [...dmActivity().entries()].map(([id, at]) => [
          id,
          contactUserItem({ id, name: '', email: '', lastInteraction: at } as any).sortTimestamp,
        ]),
        quickAccessBase: channels.map((channel) =>
          apiChannelToQuickAccessChannel(toChannelListItem(channel))
        ),
        quickAccessLoading: !directory.complete(),
        // recipient-source.ts groups
        recipients: groups.map((entity) => ({ kind: entity.kind, id: entity.id })),
        // universal-input/actions.ts messageChannels
        universalInput: channels
          .filter((channel) => channel.participants.length + channel.botParticipants.length > 2)
          .map((channel) => recipientEntityMapper('channel')(toChannelListItem(channel)))
          .map((entity) => ({ kind: entity.kind, id: entity.id })),
        // search.ts useSearchSoupQuery channelMetadata, transform-utils mapper input
        searchMetadata: channelSearchMetadata(channels),
        // search.ts useSearchChannelQuery channelNames
        searchNames: channels.map(({ id, name }) => ({ id, name })),
        searchPool: pool(),
        // create-support-link.ts
        supportId: directory.complete()
          ? (findSupportChannelId(directory.channels(), viewer) ?? null)
          : undefined,
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

  // Channel.tsx: useChannelLastViewed, read by createActivityTracker as
  // knownLastView once it is no longer pending (the entry view waits for it).
  const lastViewedOf = async (id: string) => {
    const holder: { dispose?: () => void; read?: () => ReturnType<ReturnType<typeof useChannelLastViewed>> } = {};
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        holder.dispose = dispose;
        holder.read = useChannelLastViewed(id);
      })
    );
    const started = Date.now();
    try {
      for (;;) {
        const state = holder.read?.();
        if (state && state.status !== 'pending') {
          return { status: state.status, lastViewedAt: knownLastView(state) ?? null, waitedMs: Date.now() - started };
        }
        if (Date.now() - started > LAST_VIEW_WAIT_MS + 2_000) {
          return { status: 'stuck', lastViewedAt: null, waitedMs: Date.now() - started };
        }
        await sleep(20);
      }
    } finally {
      holder.dispose?.();
    }
  };

  const contextFacts = async (timeoutMs: number) => {
    const seeded = seedLinks();
    const holder: { dispose?: () => void; read?: () => unknown } = {};
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        holder.dispose = dispose;
        // AppProviders.tsx: channels once the directory is complete
        const facts = createContactContextSource({
          account,
          channels: () => (directory.complete() ? directory.channels() : undefined),
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
    const channels = directory.channels();
    const complete = directory.complete();
    const labels = spec.labels ?? [];
    // SectionChannelsDialog.tsx available
    const available = (label: { channelIds: string[]; teamId?: string }) =>
      channels
        .filter((channel) => {
          if (label.channelIds.includes(channel.id)) return false;
          if (label.teamId) {
            return channel.channelType === 'team' && channel.teamId === label.teamId;
          }
          return (
            channel.channelType === 'team' ||
            channel.channelType === 'public' ||
            channel.channelType === 'private'
          );
        })
        .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
    const picker = labels.map((label) => {
      const rows = available(label);
      return {
        ids: rows.map((row) => row.id),
        busy: !complete,
        search: (spec.pickerSearch ?? []).map((term) =>
          PICKER_SEARCH(rows as any[], term).map((result) => result.item.id)
        ),
      };
    });
    // ChannelMuteMenu.tsx SectionMuteMenu ids, built-in sections
    const mute = ['team_channels', 'direct_messages', 'channels'].map((section) => {
      const ids = !complete
        ? []
        : channels
            .filter((channel) => {
              if (section === 'team_channels') return channel.channelType === 'team';
              if (section === 'direct_messages') return channel.channelType === 'direct_message';
              return channel.channelType !== 'team' && channel.channelType !== 'direct_message';
            })
            .map((channel) => channel.id);
      return { section, ids, disabled: !complete };
    });
    // SectionDialog.tsx channelsById / scopeChangeError
    const channelsById = new Map(
      channels.map((channel) => [
        channel.id,
        {
          channelType: channel.channelType,
          teamId: channel.teamId ?? undefined,
          isParticipant: channel.isParticipant,
        },
      ])
    );
    const dialog = labels.map((label) => {
      const initial = { channelIds: label.channelIds, channelCount: label.channelCount ?? label.channelIds.length };
      const reason = (teamId: string | undefined) => {
        if (initial.channelCount > 0 && directory.failed()) return 'channelsUnavailable';
        if (initial.channelCount > 0 && !directory.complete()) return 'checkingSharing';
        return channelSectionScopeChangeError(initial, channelsById, { teamId }) ?? null;
      };
      return { toTeam: reason(label.teamId), toPersonal: reason(undefined) };
    });
    const groupIds: Record<string, string[] | string> = {};
    if (spec.groups !== false) {
      for (const group of ['team_channels', 'channels', 'direct_messages'] as const) {
        try {
          // useChannelSectionNotifications.ts channelIdsFor
          groupIds[group] = channelGroupIds(group, [], await directory.readComplete());
        } catch (error) {
          groupIds[group] = `error:${String(error)}`;
        }
      }
    }
    return { picker, mute, dialog, groupIds };
  };

  const snapshot = async (spec: Spec = {}) => {
    const at = Date.now();
    const ids = spec.ids ?? [];
    // A pending lookup reads the channel by id; wait as the citations do.
    const settled = await runWithOwner(owner, () =>
      Promise.all(
        ids.map((id) => settledChannelLookup(directory, id, spec.lookupWaitMs ?? 5_000))
      )
    );
    const rows = spec.rows === false ? undefined : directory.channels().map(toChannelListItem);
    const perIdOut: Record<string, any> = {};
    ids.forEach((id, index) => {
      perIdOut[id] = { settled: settled?.[index]?.status ?? 'none', ...perId(id, spec) };
    });
    for (const id of ids) perIdOut[id].citation = String(await perIdOut[id].citation);
    // Every open waits for its last view; read them together, as separate opens would.
    const views = await Promise.all(ids.map((id) => lastViewedOf(id)));
    const lastViewed: Record<string, string> = {};
    ids.forEach((id, index) => {
      perIdOut[id].lastViewedAt = views[index].lastViewedAt;
      lastViewed[id] = views[index].status;
    });
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
      tree: 'branch',
      mode: mode(),
      ready: ready(),
      failed: directory.failed(),
      at,
      rows,
      perId: perIdOut,
      lists: spec.lists === false ? undefined : lists(spec),
      facts: spec.facts ? await contextFacts(20_000) : undefined,
      open: spec.open ? await openSnapshot(spec) : undefined,
      dm,
      dmOpen,
      // Not compared: how each open settled its last view.
      diag: { lastViewed },
      tookMs: Date.now() - at,
    };
  };

  (window as any).__proof = {
    tree: 'branch',
    mode,
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
    // What the branch's mutation hooks run on settle.
    refresh: () => refreshChannelDirectory(),
    recordView: (channelId: string) => recordChannelViewWhenIdle(channelId, directory),
    write,
    userId: () => userId(),
  };
  return null;
}
