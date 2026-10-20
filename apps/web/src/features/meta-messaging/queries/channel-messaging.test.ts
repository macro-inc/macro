/** @vitest-environment jsdom */
import type { MessageData } from '@core/messages/types';
import type { MessagingBinding } from '@service-storage/generated/schemas/messagingBinding';
import type { MetaConversationView } from '@service-storage/generated/schemas/metaConversationView';
import type { MetaGroupView } from '@service-storage/generated/schemas/metaGroupView';
import type { MetaSendProgress } from '@service-storage/generated/schemas/metaSendProgress';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { replyOptions } from '../tests/reply-options';
import { createChannelMessaging } from './channel-messaging';

const fixture = vi.hoisted(() => ({
  account: () => undefined as MetaConversationView | null | undefined,
  group: () => null as MetaGroupView | null,
  error: (): boolean => false,
  history: [] as MetaSendProgress[],
  readHistory: undefined as (() => string[]) | undefined,
  refetch: vi.fn(),
  enabled: () => false as boolean,
}));
vi.mock('@queries/meta-messaging', () => ({
  useMetaBinding: (_: unknown, enabled: () => boolean) => {
    fixture.enabled = enabled;
    return {
      get enabled() {
        return enabled();
      },
      get isPending() {
        return fixture.account() === undefined;
      },
      get data() {
        if (fixture.account() === undefined)
          throw new Error('Pending resource must not be read');
        return { messaging: fixture.account(), group: fixture.group() };
      },
      get isError() {
        return fixture.error();
      },
      refetch: fixture.refetch,
    };
  },
  useMetaDelivery: (_: unknown, ids: () => string[]) => {
    fixture.readHistory = ids;
    return {
      isPending: false,
      get data() {
        return fixture.history;
      },
    };
  },
}));
vi.mock('@queries/whatsapp-linked', () => ({
  useLinkedChannel: () => ({
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  }),
  useLinkedDelivery: () => ({ isPending: false, data: [] }),
}));
let dispose: () => void;
afterEach(() => {
  dispose?.();
  fixture.history = [];
  fixture.group = () => null;
  fixture.refetch.mockClear();
});
const created_at = '2026-10-12T05:00:00Z';
const send = (id = 'send-one', channel_id = 'one'): MetaSendProgress => ({
  id,
  channel_id,
  created_at,
  message_id: 'native-one',
  user_id: 'owner',
  state: 'accepted',
  payload: {
    idempotency_key: 'intent',
    message: { type: 'text', text: 'Hello' },
  },
});
const message = (id: string): MessageData => ({
  id,
  created_at,
  updated_at: created_at,
  content: 'Hello',
  sender_id: 'macro|owner',
  imported_author: { name: 'Business · sent via WhatsApp' },
  attachments: [],
  reactions: [],
});
const account = (sends = [send()]): MetaConversationView => ({
  ...replyOptions(),
  provider: 'whatsapp',
  account_name: 'Business',
  status: 'connected',
  can_reply: true,
  developer_account: false,
  human_agent_approved: false,
  text_limit: 4096,
  text_limit_in_bytes: false,
  media: [],
  sends,
  conversation: {
    channel_id: 'one',
    connection_id: 'account-one',
    customer_id: 'customer',
  },
});
function setup(
  initial?: MetaConversationView | null,
  nativeBinding: MessagingBinding | undefined = 'whatsapp_direct'
) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [value, setAccount] = createSignal(initial);
    fixture.account = value;
    const [error, setError] = createSignal(false);
    fixture.error = error;
    const [channelId, setChannel] = createSignal('one');
    const [metadata, setMetadata] = createSignal<MessagingBinding | undefined>(
      nativeBinding
    );
    const [metadataError, setMetadataError] = createSignal<Error | null>(null);
    const refetchMetadata = vi.fn();
    const [messages, setMessages] = createSignal<MessageData[]>([]);
    const state = createChannelMessaging({
      channelId,
      binding: {
        value: metadata,
        error: metadataError,
        isPending: () => !metadata(),
        refetch: refetchMetadata,
      },
      messages,
      entries: () =>
        messages().map((message) => ({
          key: message.id,
          position: { id: message.id, createdAt: message.created_at },
        })),
      includesLatest: () => true,
      visibleRange: () => undefined,
    });
    return {
      state,
      setAccount,
      setChannel,
      setMessages,
      setError,
      setMetadata,
      setMetadataError,
      refetchMetadata,
    };
  });
}
it('never reads a pending resource and hands an accepted send to its native row without a gap', () => {
  const { state, setAccount, setMessages } = setup();
  expect(state.timelineKeys()).toEqual([]);
  setAccount(account());
  expect(state.timelineKeys()).toEqual(['external-send:send-one']);
  setMessages([message('native-one')]);
  expect(state.timelineKeys()).toEqual(['native-one']);
  expect(state.attemptsByKey().size).toBe(0);
  expect(state.deliveryByMessage().get('native-one')?.state).toBe('accepted');
});
it('fetches only missing history and cannot expose delivery from another channel', () => {
  fixture.history = [send('history', 'other')];
  const { state, setMessages, setChannel } = setup(account());
  setMessages([message('native-one'), message('native-older')]);
  expect(fixture.readHistory?.()).toEqual(['native-older']);
  expect(state.deliveryByMessage().size).toBe(1);
  setChannel('other');
  expect(state.account()).toBeUndefined();
  expect(state.deliveryByMessage().size).toBe(0);
  expect(fixture.readHistory?.()).toEqual([]);
});
it('loads historical delivery for an early echo attributed to a native sender', () => {
  const historical = { ...send('older-send'), message_id: 'older-echo' };
  fixture.history = [historical];
  const { state, setMessages } = setup(account([]));
  setMessages([
    { ...message('older-echo'), imported_author: undefined },
    { ...message('customer'), sender_id: 'external|customer' },
  ]);
  expect(fixture.readHistory?.()).toEqual(['older-echo']);
  expect(state.deliveryByMessage().get('older-echo')).toEqual(historical);
});

it('recovery stays scoped to the active channel and survives overlapping composer cleanup', () => {
  const { state } = setup(account());
  const old = vi.fn();
  const current = vi.fn();
  const removeOld = state.registerRecovery(old);
  const removeCurrent = state.registerRecovery(current);
  removeOld();
  state.recoverReply(send());
  state.recoverReply(send('foreign', 'other'));
  expect(old).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
  removeCurrent();
  expect(state.canRecoverReply()).toBe(false);
});

it('refreshes reply eligibility for new customer activity without polling on internal messages or older history', () => {
  const { setMessages } = setup(account());
  const customer = {
    ...message('customer-one'),
    sender_id: 'external|customer',
  };
  setMessages([customer]);
  expect(fixture.refetch).toHaveBeenCalledOnce();
  fixture.refetch.mockClear();
  setMessages([customer, message('internal-note')]);
  setMessages([
    customer,
    { ...customer, id: 'older-customer', created_at: '2026-10-11T00:00:00Z' },
  ]);
  expect(fixture.refetch).not.toHaveBeenCalled();
  setMessages([
    customer,
    { ...customer, id: 'customer-two', created_at: '2026-10-12T05:01:00Z' },
  ]);
  expect(fixture.refetch).toHaveBeenCalledOnce();
});

it('uses one safe interaction contract across unknown, internal and external bindings', () => {
  const { state, setAccount, setError, setChannel } = setup();
  expect(state.interaction().kind).toBe('loading');
  setError(true);
  expect(state.interaction().kind).toBe('error');
  setError(false);
  setAccount(null);
  expect(state.interaction().kind).toBe('error');
  setError(true);
  expect(state.interaction().kind).toBe('error');
  setError(false);
  setAccount(account());
  expect(state.interaction().kind).toBe('external');
  setError(true);
  expect(state.interaction()).toMatchObject({
    kind: 'external',
    available: false,
  });
  setAccount(undefined);
  setChannel('two');
  expect(state.interaction().kind).toBe('error');
});

it('keeps a cached internal binding when a remounted channel cannot refresh it', () => {
  const { state, setError } = setup(null, 'native');
  setError(true);
  dispose();
  const remounted = setup(null, 'native');
  remounted.setError(true);
  expect(remounted.state.interaction().kind).toBe('internal');
  expect(state.interaction().kind).toBe('internal');
});

it('known native channels never depend on messaging lookups', () => {
  const { state, setError } = setup(undefined, 'native');
  setError(true);
  expect(state.interaction().kind).toBe('internal');
  expect(state.account()).toBeUndefined();
  expect(fixture.enabled()).toBe(false);
});

it('pending groups never expose an ordinary internal composer', () => {
  fixture.group = () => ({
    channel_id: 'one',
    setup: {
      channel_id: 'one',
      connection_id: 'connection',
      subject: 'Project',
      state: 'unknown',
    },
    participants: [],
    can_retry: true,
    can_copy_link: false,
    can_remove: false,
    can_delete: true,
  });
  const { state } = setup(null, 'whatsapp_group');
  expect(state.interaction().kind).toBe('group_setup');
  expect(state.account()).toBeUndefined();
});

it('retries unknown native metadata without enabling native sends or Meta requests', () => {
  const { state, setMetadata, setMetadataError, refetchMetadata } = setup(
    null,
    'native'
  );
  setMetadata(undefined);
  expect(state.interaction()).toEqual({ kind: 'loading' });
  expect(fixture.enabled()).toBe(false);
  setMetadataError(new Error('Metadata unavailable'));
  expect(state.interaction()).toEqual({ kind: 'error' });
  state.refresh();
  expect(refetchMetadata).toHaveBeenCalledOnce();
  expect(fixture.refetch).not.toHaveBeenCalled();
  setMetadataError(null);
  setMetadata('native');
  expect(state.interaction()).toEqual({ kind: 'internal' });
  expect(fixture.enabled()).toBe(false);
  setMetadata('instagram_direct');
  expect(fixture.enabled()).toBe(true);
  expect(state.interaction().kind).not.toBe('internal');
});
