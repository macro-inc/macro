import type { useChannelMessagingBinding } from '@core/context/channels';
import type { MessageData } from '@core/messages/types';
import { queryReadyGate } from '@queries/gate';
import {
  useMetaBinding,
  type useMetaConversation,
  useMetaDelivery,
} from '@queries/meta-messaging';
import { useLinkedChannel, useLinkedDelivery } from '@queries/whatsapp-linked';
import type { MetaConversationView } from '@service-storage/generated/schemas/metaConversationView';
import type { MetaSendProgress } from '@service-storage/generated/schemas/metaSendProgress';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import type {
  ChannelInteraction,
  ConversationAccount,
} from '../core/conversation';
import {
  deliveryTimelineKeys,
  type MessagingTimelineEntry,
  sendRowKey,
  visibleDeliveryIds,
} from '../core/timeline';

/** Resolve the shared interaction state before exposing native channel actions. */
export function createChannelInteraction(options: {
  channelId: Accessor<string>;
  binding: ReturnType<typeof useChannelMessagingBinding>;
}) {
  const possible = () =>
    !!options.binding.value() &&
    options.binding.value() !== 'native' &&
    options.binding.value() !== 'whatsapp_linked_group';
  const messagingQuery = useMetaBinding(() => options.channelId(), possible);
  const isLinked = () => options.binding.value() === 'whatsapp_linked_group';
  const linkedQuery = useLinkedChannel(() => options.channelId(), isLinked);
  const linkedAccount = ():
    | (MetaConversationView & {
        transport: 'linked';
        authorization_generation: number;
      })
    | undefined => {
    if (!isLinked() || !queryReadyGate(linkedQuery)) return;
    const view = linkedQuery.data;
    return {
      provider: 'whatsapp',
      transport: 'linked',
      authorization_generation: view.account.authorization_generation,
      account_name:
        view.account.identity_jid?.split('@')[0] ?? 'Your WhatsApp account',
      status:
        view.account.state === 'connected'
          ? 'connected'
          : view.account.state === 'connecting'
            ? 'connecting'
            : 'disconnected',
      health_error:
        view.account.state === 'offline' ? 'temporarily_offline' : null,
      can_reply: view.can_reply,
      capabilities: view.capabilities,
      eligibility: view.eligibility,
      sends: view.sends,
      developer_account: false,
      human_agent_approved: false,
      media: view.capabilities.media,
      text_limit: view.capabilities.text_limit,
      text_limit_in_bytes: view.capabilities.text_limit_in_bytes,
      conversation: {
        channel_id: view.binding.channel_id,
        connection_id: view.account.id,
        customer_id: view.binding.group_jid,
        kind: 'group',
        group_status: view.binding.state === 'active' ? 'active' : 'suspended',
      },
    };
  };
  const binding = createMemo<
    | {
        channelId: string;
        account: NonNullable<typeof messagingQuery.data>['messaging'];
        group?: NonNullable<typeof messagingQuery.data>['group'];
      }
    | undefined
  >((previous) => {
    const channelId = options.channelId();
    if (!options.binding.value()) return undefined;
    if (options.binding.value() === 'native')
      return { channelId, account: null };
    if (!possible()) return undefined;
    // Cached data stays authoritative after a failed refetch; external sends
    // remain unavailable until the server answers again.
    if (queryReadyGate(messagingQuery)) {
      const account = messagingQuery.data.messaging;
      if (
        messagingQuery.data.group &&
        messagingQuery.data.group.channel_id !== channelId
      )
        return undefined;
      if (account && account.conversation.channel_id !== channelId)
        return undefined;
      return { channelId, account, group: messagingQuery.data.group };
    }
    return previous?.channelId === channelId ? previous : undefined;
  });
  const messaging = () => linkedAccount() ?? binding()?.account ?? undefined;
  const interaction = (): ChannelInteraction => {
    if (!options.binding.value())
      return { kind: options.binding.error() ? 'error' : 'loading' };
    if (options.binding.error()) return { kind: 'error' };
    if (isLinked()) {
      const account = linkedAccount();
      if (!account) return { kind: linkedQuery.isError ? 'error' : 'loading' };
      return {
        kind: 'external',
        account: {
          ...toConversationAccount(account),
          transport: 'linked',
          authorization_generation: account.authorization_generation,
        },
        available: !linkedQuery.isError,
      };
    }
    const known = binding();
    if (known) {
      if (known.group?.setup) return { kind: 'group_setup' };
      if (!known.account)
        return {
          kind: options.binding.value() === 'native' ? 'internal' : 'error',
        };
      if (!known.account.capabilities || !known.account.eligibility)
        return { kind: 'error' };
      return {
        kind: 'external',
        account: toConversationAccount(known.account),
        available: !messagingQuery.isError,
      };
    }
    return { kind: messagingQuery.isError ? 'error' : 'loading' };
  };
  return {
    account: messaging,
    group: () => binding()?.group,
    interaction,
    refresh: () => {
      if (!options.binding.value() || options.binding.error()) {
        void options.binding.refetch();
      } else if (isLinked()) void linkedQuery.refetch();
      else if (possible()) void messagingQuery.refetch();
    },
  };
}

/** Own the external send feed and its handoff to the native message timeline. */
export function createChannelMessaging(options: {
  channelId: Accessor<string>;
  binding: ReturnType<typeof useChannelMessagingBinding>;
  messages: Accessor<readonly MessageData[]>;
  entries: Accessor<readonly MessagingTimelineEntry[]>;
  includesLatest: Accessor<boolean>;
  visibleRange: Accessor<{ first: string; last: string } | undefined>;
}) {
  const state = createChannelInteraction(options);
  const messaging = state.account;
  const latestCustomerMessage = createMemo(() => {
    if (!options.includesLatest()) return undefined;
    let latest: MessageData | undefined;
    for (const message of options.messages()) {
      if (!message.sender_id.startsWith('external|')) continue;
      if (
        !latest ||
        Date.parse(message.created_at) > Date.parse(latest.created_at)
      )
        latest = message;
    }
    return latest?.id;
  });
  // Native messages arrive over the channel socket. Refresh server-owned reply
  // eligibility immediately instead of waiting for the idle recovery poll.
  createEffect(
    on(
      latestCustomerMessage,
      (id) => {
        if (id && messaging()) state.refresh();
      },
      { defer: true }
    )
  );
  const [recoverExternalReply, setRecoverExternalReply] =
    createSignal<(send: MetaSendProgress) => void>();
  const recentDelivery = createMemo(
    () =>
      new Map(
        (messaging()?.sends ?? [])
          .filter((send) => send.message_id)
          .map((send) => [send.message_id, send])
      )
  );
  const nativeIds = createMemo(
    () => new Set(options.messages().map((message) => message.id))
  );
  const attemptsByKey = createMemo(
    () =>
      new Map(
        (messaging()?.sends ?? [])
          .filter(
            (send) => !send.message_id || !nativeIds().has(send.message_id)
          )
          .map((send) => [sendRowKey(send.id), send])
      )
  );
  const timelineKeys = createMemo(() =>
    deliveryTimelineKeys(
      options.channelId(),
      options.entries(),
      messaging()?.sends ?? [],
      options.includesLatest()
    )
  );
  const historyMessageIds = createMemo(() =>
    messaging()
      ? visibleDeliveryIds(
          timelineKeys(),
          new Set(
            options
              .messages()
              .filter((message) => !message.sender_id.startsWith('external|'))
              .map((message) => message.id)
          ),
          new Set(
            [...recentDelivery().keys()].filter((id): id is string => !!id)
          ),
          options.visibleRange()
        )
      : []
  );
  const historyDelivery = useMetaDelivery(
    () => options.channelId(),
    () =>
      options.binding.value() === 'whatsapp_linked_group'
        ? []
        : historyMessageIds()
  );
  const linkedDelivery = useLinkedDelivery(
    () => options.channelId(),
    () =>
      options.binding.value() === 'whatsapp_linked_group'
        ? historyMessageIds()
        : []
  );
  const deliveryByMessage = createMemo(() => {
    if (!messaging()) return new Map<string, MetaSendProgress>();
    const history =
      options.binding.value() === 'whatsapp_linked_group'
        ? queryReadyGate(linkedDelivery)
          ? linkedDelivery.data
          : []
        : queryReadyGate(historyDelivery)
          ? historyDelivery.data
          : [];
    return new Map([
      ...(history ?? [])
        .filter(
          (send) => send.channel_id === options.channelId() && send.message_id
        )
        .map((send) => [send.message_id, send] as const),
      ...recentDelivery(),
    ]);
  });
  const canRecoverReply = () =>
    !!messaging()?.can_reply && !!recoverExternalReply();
  const recoverReply = (send: MetaSendProgress) => {
    if (send.channel_id === options.channelId()) recoverExternalReply()?.(send);
  };

  return {
    account: messaging,
    interaction: state.interaction,
    refresh: state.refresh,
    timelineKeys,
    attemptsByKey,
    deliveryByMessage,
    canRecoverReply,
    recoverReply,
    registerRecovery: (recover: (send: MetaSendProgress) => void) => {
      setRecoverExternalReply(() => recover);
      return () => {
        if (recoverExternalReply() === recover)
          setRecoverExternalReply(undefined);
      };
    },
  };
}

/** Keep wire compatibility fields out of the common composer's contract. */
function toConversationAccount(
  account: NonNullable<ReturnType<typeof useMetaConversation>['data']>
): ConversationAccount {
  return {
    provider: account.provider,
    account_name: account.account_name,
    status: account.status,
    health_error: account.health_error,
    can_reply: account.can_reply,
    capabilities: account.capabilities,
    eligibility: account.eligibility,
    conversation: {
      channel_id: account.conversation.channel_id,
      connection_id: account.conversation.connection_id,
      customer_id: account.conversation.customer_id,
      customer_display_name: account.conversation.customer_display_name,
      customer_handle: account.conversation.customer_handle,
      customer_phone: account.conversation.customer_phone,
    },
  };
}
