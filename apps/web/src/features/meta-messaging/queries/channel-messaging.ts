import type { useChannelMessagingBinding } from '@core/context/channels';
import type { MessageData } from '@core/messages/types';
import { queryReadyGate } from '@queries/gate';
import {
  useMetaBinding,
  type useMetaConversation,
  useMetaDelivery,
} from '@queries/meta-messaging';
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
    !!options.binding.value() && options.binding.value() !== 'native';
  const messagingQuery = useMetaBinding(() => options.channelId(), possible);
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
  const messaging = () => binding()?.account ?? undefined;
  const interaction = (): ChannelInteraction => {
    if (!options.binding.value())
      return { kind: options.binding.error() ? 'error' : 'loading' };
    if (options.binding.error()) return { kind: 'error' };
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
      } else if (possible()) void messagingQuery.refetch();
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
    historyMessageIds
  );
  const deliveryByMessage = createMemo(() => {
    if (!messaging()) return new Map<string, MetaSendProgress>();
    const history = queryReadyGate(historyDelivery) ? historyDelivery.data : [];
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
