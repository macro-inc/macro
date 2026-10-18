import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BrowserContext,
  expect as baseExpect,
  test as baseTest,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { buildSchema, graphql } from 'graphql';
import { replyOptions } from '../../../src/features/meta-messaging/tests/reply-options';
import type { MessageEvent } from '../../../src/lib/service-clients/service-storage/generated/schemas/messageEvent';
import type { MetaConnection } from '../../../src/lib/service-clients/service-storage/generated/schemas/metaConnection';
import type { MetaConversationView } from '../../../src/lib/service-clients/service-storage/generated/schemas/metaConversationView';
import type { MetaGroupView } from '../../../src/lib/service-clients/service-storage/generated/schemas/metaGroupView';
import type { MetaSendProgress } from '../../../src/lib/service-clients/service-storage/generated/schemas/metaSendProgress';
import type { MetaSendReply } from '../../../src/lib/service-clients/service-storage/generated/schemas/metaSendReply';
import type { SoupInput } from '../../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import type {
  MessageListItem,
  MessageTimelineEntry,
} from '../../../src/lib/service-clients/service-storage/messages';
import { bootstrapResponses } from '../../native/fixtures/bootstrap';
import { USER_ID } from '../../native/fixtures/mail';

export const expect = baseExpect.configure({ timeout: 30_000 });

async function setupMessaging({
  page,
  context,
  baseURL,
}: {
  page: Page;
  context: BrowserContext;
  baseURL: string | undefined;
}) {
  const state = {
    group: undefined as MetaGroupView | undefined,
    groupChannelId: '',
    groupRemovalFails: true,
    groupDeleteCalls: 0,
    groupCreateCalls: 0,
    loseCreateResponse: true,
    activeUser: USER_ID,
    denied: false,
    bindingError: false,
    holdBinding: false,
    unknownSend: false,
    windowClosed: false,
    failSend: false,
    expireSend: false,
    showSettings: false,
    omitSidebar: false,
    metadataError: false,
  };
  const origin = baseURL!;
  await context.addCookies([{ name: 'login', value: 'true', url: origin }]);
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(90000);
  const errors: string[] = [];
  const unknown = new Set<string>();
  const metaRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/meta/'))
      metaRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const gateways = new Set<WebSocketRoute>();
  await page.routeWebSocket('**/*', (socket) => {
    if (socket.url().includes('/dss/items/soup/graphql/ws')) {
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message)) as { type: string };
        if (frame.type === 'connection_init')
          socket.send(JSON.stringify({ type: 'connection_ack' }));
        if (frame.type === 'ping')
          socket.send(JSON.stringify({ type: 'pong' }));
      });
      return;
    }
    if (!socket.url().includes('/connection-gateway')) return socket.close();
    gateways.add(socket);
    socket.onMessage((message) => {
      if (message === 'ping') socket.send('pong');
    });
    socket.onClose(() => gateways.delete(socket));
  });
  const id = (number: number) =>
    `019a0000-0000-7000-8000-${number.toString().padStart(12, '0')}`;
  const channels: Array<{
    id: string;
    name: string;
    provider: 'whatsapp' | 'instagram' | null;
  }> = [
    { id: id(101), name: 'Native team conversation', provider: null },
    { id: id(102), name: 'WhatsApp customer', provider: 'whatsapp' },
    { id: id(103), name: 'Instagram customer', provider: 'instagram' },
  ];
  const submissions: MetaSendReply[] = [];
  const sends = new Map<string, MetaSendProgress[]>();
  const seenNotifications = new Set<string>();
  const time = (offset: number) =>
    new Date(Date.now() - 7200000 + offset * 60000).toISOString();
  const settingsAccount: MetaConnection = {
    id: id(810),
    team_id: id(800),
    user_id: USER_ID,
    provider: 'whatsapp',
    account_id: 'controlled-platform',
    display_name: 'Controlled Platform account',
    status: 'connecting',
    developer_account: false,
    human_agent_approved: false,
    whatsapp_mode: 'platform',
    registration_status: 'required',
    health_error: 'registration_required',
    connected_at: new Date().toISOString(),
  };
  const otherAccount: MetaConnection = {
    ...settingsAccount,
    id: id(811),
    user_id: 'macro|other-connector@example.com',
    account_id: 'other-business',
    display_name: 'Other member’s account',
    status: 'connected',
    whatsapp_mode: 'coexistence',
    registration_status: null,
    health_error: null,
  };
  const registrations: Array<{ pin?: string }> = [];
  function message(
    channel: string,
    number: number,
    content: string,
    external = false
  ): MessageListItem {
    const created_at = time(number % 100);
    const sender_id = external ? `external|${id(900)}` : state.activeUser;
    return {
      id: id(number),
      parent: { type: 'channel', id: channel },
      sender_id,
      imported_author: external ? { name: 'Test Customer' } : null,
      content,
      created_at,
      updated_at: created_at,
      mentions: [],
      reactions: [],
      attachments: [],
      state: {
        root_id: id(number),
        user_id: sender_id,
        created_at,
        updated_at: created_at,
        resolved: false,
      },
      thread: { reply_count: 0, preview: [] },
    };
  }
  const messages = new Map<string, MessageListItem[]>(
    channels.map((channel, index) => [
      channel.id,
      Array.from({ length: 35 }, (_, number) =>
        message(
          channel.id,
          1000 + index * 100 + number,
          `${channel.name} message ${number + 1}`,
          !!channel.provider
        )
      ),
    ])
  );
  const unreadReply = message(channels[0].id, 9100, 'Unread thread reply');
  unreadReply.thread_id = messages.get(channels[0].id)![3].id;
  unreadReply.sender_id = 'macro|teammate@browser.test';
  unreadReply.created_at = time(4);
  unreadReply.updated_at = unreadReply.created_at;
  messages.get(channels[0].id)![3].thread = {
    reply_count: 1,
    preview: [unreadReply],
  };
  function event(
    value: MessageListItem,
    type: 'posted' | 'edited' | 'message_deleted' = 'posted'
  ) {
    const change: MessageEvent['change'] =
      type === 'posted'
        ? { type, message: value, mentions: [], notification_policy: 'Silent' }
        : type === 'edited'
          ? {
              type,
              message: value,
              mentions: [],
              notification_policy: 'Default',
              previous_attachments: [],
            }
          : { type, message: value };
    const data: MessageEvent = {
      actor: state.activeUser,
      parent: value.parent,
      change,
    };
    for (const socket of gateways)
      socket.send(JSON.stringify({ type: 'message_update', data }));
  }
  function conversation(channelId: string): MetaConversationView | null {
    const channel = channels.find((channel) => channel.id === channelId)!;
    if (
      !channel.provider ||
      (channelId === state.groupChannelId && state.group?.setup)
    )
      return null;
    const options = replyOptions(channel.provider);
    if (state.windowClosed)
      options.eligibility.modes[0] = {
        mode: 'free_form',
        allowed: false,
        reason: 'template_required',
      };
    if (state.denied)
      for (const mode of options.eligibility.modes) {
        mode.allowed = false;
        mode.reason = 'forbidden';
      }
    return {
      ...options,
      provider: channel.provider,
      account_name: 'Test Business',
      status: 'connected',
      can_reply: !state.denied,
      // Conversation details must not surface developer-only setup.
      developer_account: true,
      human_agent_approved: false,
      text_limit: options.capabilities.text_limit,
      text_limit_in_bytes: options.capabilities.text_limit_in_bytes,
      media: options.capabilities.media,
      sends: sends.get(channelId) ?? [],
      conversation: {
        channel_id: channelId,
        connection_id: id(500),
        kind: channelId === state.groupChannelId ? 'group' : 'direct',
        group_status: channelId === state.groupChannelId ? 'active' : null,
        customer_id:
          channelId === state.groupChannelId ? 'opaque-group' : 'test-customer',
        customer_display_name: 'Test Customer',
        customer_handle:
          channel.provider === 'instagram' ? 'test.customer' : null,
        customer_phone:
          channel.provider === 'whatsapp' ? '+1 202 555 0147' : null,
        last_customer_message_at: time(35),
      },
    };
  }
  function soupItem(channel: (typeof channels)[number]) {
    const latest = messages.get(channel.id)?.at(-1);
    const preview = latest
      ? {
          messageId: latest.id,
          channelId: channel.id,
          threadId: null,
          senderId: latest.sender_id,
          content: latest.content,
          createdAt: latest.created_at,
          updatedAt: latest.updated_at,
          deletedAt: null,
          mentions: [],
        }
      : null;
    return {
      __typename: 'GraphqlSoupChannel',
      id: channel.id,
      entityType: 'CHANNEL',
      name: channel.name,
      displayName: channel.name,
      channelType: 'private',
      messagingBinding:
        channel.id === state.groupChannelId
          ? 'whatsapp_group'
          : channel.provider
            ? `${channel.provider}_direct`
            : 'native',
      ownerId: state.activeUser,
      organizationId: null,
      teamId: null,
      createdAt: time(0),
      updatedAt: latest?.updated_at ?? time(0),
      viewedAt: null,
      interactedAt: null,
      isParticipant: true,
      participants: [
        {
          channelId: channel.id,
          userId: state.activeUser,
          role: 'owner',
          joinedAt: time(0),
          leftAt: null,
        },
      ],
      latestMessage: preview,
      latestNonThreadMessage: preview,
      cacheProjection: null,
      isFavorited: false,
      notifications: channel.provider
        ? []
        : [
            {
              id: id(300 + channels.indexOf(channel)),
              entityType: 'CHANNEL',
              entityId: channel.id,
              eventType: 'channel_reply',
              state: seenNotifications.has(id(300 + channels.indexOf(channel)))
                ? 'SEEN'
                : 'UNSEEN',
              sent: true,
              createdAt: messages.get(channel.id)![3].created_at,
              updatedAt: messages.get(channel.id)![3].created_at,
              viewedAt: null,
              senderId: null,
              metadata: {
                __typename: 'GraphqlChannelReplyMetadata',
                messageId: unreadReply.id,
                threadId: messages.get(channel.id)![3].id,
                userId: unreadReply.sender_id,
                threadParentSenderId: state.activeUser,
                messageContent: 'Unread customer message',
                sender: null,
                senderDisplayName: 'Test Customer',
                channelType: 'PRIVATE',
                channelName: channel.name,
                hasAttachments: false,
                senderProfilePictureUrl: null,
              },
            },
          ],
    };
  }
  const schema = buildSchema(
    readFileSync(resolve('../../static_assets/schema.graphql'), 'utf8')
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (url.origin !== origin) return route.abort();
    if (
      ['script', 'stylesheet', 'font', 'image', 'media'].includes(
        request.resourceType()
      ) ||
      /^\/(app|@|src|node_modules|local|assets|fonts)(?:\/|$)/.test(path) ||
      path.startsWith('/__vite') ||
      path.startsWith('/@') ||
      path === '/' ||
      path.endsWith('.wasm')
    )
      return route.continue();
    if (path === '/auth/team/user')
      return respond([
        {
          id: id(800),
          name: 'Controlled team',
          owner_id: 'macro|other-connector@example.com',
          default_link_share: 'off',
        },
      ]);
    if (path === '/auth/team' && state.showSettings)
      return respond({
        team: {
          id: id(800),
          name: 'Controlled team',
          owner_id: 'macro|other-connector@example.com',
          default_link_share: 'off',
        },
        members: [
          { user_id: USER_ID, role: 'member' },
          { user_id: 'macro|other-connector@example.com', role: 'owner' },
        ],
      });
    if (path === '/dss/meta/configuration')
      return respond({
        instagram_human_agent_approved: false,
        whatsapp_developer_available: false,
        whatsapp_app_id: 'controlled-app',
        whatsapp_configuration_id: 'coexistence-config',
        whatsapp_platform_configuration_id: 'platform-config',
        instagram_app_id: null,
        instagram_redirect_uri: null,
        graph_version: 'v26.0',
      });
    if (path === `/dss/meta/connections/${settingsAccount.id}/groups`) {
      const input = request.postDataJSON() as {
        channel_id: string;
        subject: string;
      };
      if (state.groupChannelId === input.channel_id && state.group) {
        assert.equal(
          input.subject,
          state.group.setup?.subject,
          'an uncertain create retains its subject'
        );
        return respond(state.group.setup);
      }
      state.groupCreateCalls++;
      state.groupChannelId = input.channel_id;
      channels.push({
        id: state.groupChannelId,
        name: input.subject,
        provider: 'whatsapp',
      });
      messages.set(state.groupChannelId, []);
      state.group = {
        channel_id: state.groupChannelId,
        setup: {
          channel_id: state.groupChannelId,
          connection_id: settingsAccount.id,
          subject: input.subject,
          state: 'pending',
        },
        status: null,
        participants: [],
        can_retry: false,
        can_copy_link: false,
        can_remove: false,
        can_delete: true,
      };
      if (state.loseCreateResponse) {
        state.loseCreateResponse = false;
        return route.abort('failed');
      }
      return respond(state.group.setup);
    }
    if (
      state.group &&
      path === `/dss/meta/channels/${state.groupChannelId}/group/link`
    )
      return respond({ invite_link: 'https://chat.whatsapp.com/fixture' });
    if (
      state.group &&
      path ===
        `/dss/meta/channels/${state.groupChannelId}/group/participants/${id(950)}`
    ) {
      if (state.groupRemovalFails) {
        state.groupRemovalFails = false;
        return respond({ code: 'temporarily_unavailable' }, 503);
      }
      state.group.participants = [];
      return respond(null);
    }
    if (
      state.group &&
      path === `/dss/meta/channels/${state.groupChannelId}/group` &&
      request.method() === 'DELETE'
    ) {
      state.groupDeleteCalls++;
      // A stale list must not keep the confirmed-deleted channel open.
      return respond({ message: 'deleted' });
    }
    if (path === '/dss/meta/connections')
      return respond([settingsAccount, otherAccount]);
    if (path === `/dss/meta/connections/${settingsAccount.id}/history`)
      return respond({
        can_import: false,
        reason:
          'Platform numbers have no WhatsApp Business-app history to import.',
        import: null,
      });
    if (path === `/dss/meta/connections/${settingsAccount.id}/register`) {
      const input = request.postDataJSON() as { pin?: string };
      registrations.push(input);
      settingsAccount.registration_status = input.pin
        ? 'unconfirmed'
        : 'registered';
      settingsAccount.status = input.pin ? 'connecting' : 'connected';
      settingsAccount.health_error = input.pin
        ? 'registration_unconfirmed'
        : null;
      // The server retains uncertainty even if the first registration response is lost.
      if (input.pin) return route.abort('failed');
      return respond(settingsAccount);
    }
    if (path === '/auth/jwt/refresh') return respond({});
    if (path === '/dss/history') return respond({ data: [] });
    if (path === '/notification/user_notifications')
      return respond({ items: [], next_cursor: null });
    if (path === '/calendar/calendars') return respond({ calendars: [] });
    if (path === '/email/email/backfill/gmail') return respond({ jobs: [] });
    if (path === '/dss/forms/accessible') return respond([]);
    if (path === '/dss/favorites') return respond({ favorites: [] });
    if (path === '/dss/calendar-events')
      return respond({ items: [], next_cursor: null });
    if (path === '/dss/items/soup/graphql') {
      const body = request.postDataJSON() as {
        query: string;
        variables?: Record<string, unknown>;
        operationName?: string;
      };
      const result = await graphql({
        schema,
        source: body.query,
        variableValues: body.variables,
        operationName: body.operationName,
        rootValue: {
          renameEntities: ({
            inputs,
          }: {
            inputs: { entity: { id: string }; displayName: string }[];
          }) => ({
            results: inputs.map((input) => {
              const channel = channels.find(
                (channel) => channel.id === input.entity.id
              )!;
              channel.name = input.displayName;
              return { __typename: 'GraphqlMutationSuccess', effects: [] };
            }),
          }),
          updateNotifications: ({
            input,
          }: {
            input: { notificationIds: string[] };
          }) => {
            const updated = channels
              .flatMap((channel) => soupItem(channel).notifications)
              .filter((notification) =>
                input.notificationIds.includes(notification.id)
              );
            for (const notification of updated) {
              seenNotifications.add(notification.id);
              notification.state = 'SEEN';
            }
            return updated;
          },
          recordChannelActivity: ({
            input,
          }: {
            input: { channelId: string };
          }) => ({
            id: id(880),
            userId: state.activeUser,
            channelId: input.channelId,
            createdAt: time(0),
            updatedAt: new Date().toISOString(),
            viewedAt: new Date().toISOString(),
            interactedAt: null,
          }),
          user: {
            id: state.activeUser,
            emailLinks: [],
            emailLabels: [],
            favorites: [],
            soup: ({ input }: { input: SoupInput }) => {
              const channelId =
                input.initial?.filters?.channelFilter?.literal?.channelId;
              return {
                items:
                  body.operationName === 'ChannelListSoup'
                    ? channels.map(soupItem)
                    : channelId
                      ? channels
                          .filter((channel) => channel.id === channelId)
                          .map((channel) => ({
                            ...soupItem(channel),
                            notifications: soupItem(
                              channel
                            ).notifications.filter(
                              (notification) => notification.state === 'UNSEEN'
                            ),
                          }))
                      : [],
                nextCursor: null,
              };
            },
          },
        },
      });
      if (result.errors)
        errors.push(...result.errors.map((error) => error.message));
      return respond(result);
    }
    const meta = path.match(
      /^\/dss\/meta\/channels\/([^/]+)(?:\/(replies|delivery|templates))?$/
    );
    if (meta) {
      const channel = meta[1];
      if (!meta[2]) {
        if (state.holdBinding) return;
        return state.bindingError
          ? respond({}, 503)
          : respond({
              messaging: conversation(channel),
              group: channel === state.groupChannelId ? state.group : null,
            });
      }
      if (meta[2] === 'delivery') return respond(sends.get(channel) ?? []);
      if (meta[2] === 'templates')
        return respond([
          {
            id: 'approved-template',
            name: 'order_update',
            language: 'en_US',
            components: [
              { type: 'BODY', text: 'Hello {{1}}, your order is ready.' },
            ],
            parameter_labels: ['body 1'],
          },
        ]);
      const payload = request.postDataJSON() as MetaSendReply;
      if (state.denied) return respond({}, 403);
      submissions.push(payload);
      const attempt: MetaSendProgress = {
        id: id(5000 + submissions.length),
        channel_id: channel,
        user_id: state.activeUser,
        created_at: new Date(
          Date.now() - (state.expireSend ? 600001 : 0)
        ).toISOString(),
        state: state.unknownSend
          ? 'unknown'
          : state.failSend || state.expireSend
            ? 'failed'
            : 'pending',
        error_code: state.expireSend
          ? 'send_expired'
          : state.failSend
            ? 'provider_rejected'
            : null,
        payload,
      };
      sends.set(channel, [...(sends.get(channel) ?? []), attempt]);
      if (!state.unknownSend && !state.failSend && !state.expireSend)
        setTimeout(() => {
          const native = message(
            channel,
            6000 + submissions.length,
            payload.message.type === 'text'
              ? payload.message.text
              : 'Attachment'
          );
          native.created_at = attempt.created_at;
          native.updated_at = attempt.created_at;
          native.imported_author = { name: 'Test Business' };
          messages.get(channel)!.push(native);
          attempt.state = 'accepted';
          attempt.message_id = native.id;
          event(native);
        }, 1200);
      return respond(attempt);
    }
    const timeline = path.match(
      /^\/dss\/messages\/channel\/([^/]+)\/timeline$/
    );
    if (timeline) {
      const entries: MessageTimelineEntry[] = messages
        .get(timeline[1])!
        .map((message) => ({ type: 'message', message }));
      entries.push({
        type: 'activity',
        activity: {
          id: id(700),
          actor_id: state.activeUser,
          occurred_at: time(33),
          action: 'renamed',
          payload: { to: 'Conversation ready' },
        },
      });
      return respond({
        entries: entries.sort((a, b) =>
          (b.type === 'message'
            ? b.message.created_at
            : b.activity.occurred_at
          ).localeCompare(
            a.type === 'message' ? a.message.created_at : a.activity.occurred_at
          )
        ),
        next_cursor: null,
        previous_cursor: null,
      });
    }
    const item = path.match(
      /^\/dss\/messages\/channel\/([^/]+)\/items\/([^/]+)$/
    );
    if (item) {
      const value = [...messages.get(item[1])!, unreadReply].find(
        (message) => message.id === item[2]
      );
      return value ? respond(value) : respond({}, 404);
    }
    const thread = path.match(
      /^\/dss\/messages\/channel\/([^/]+)\/threads\/([^/]+)$/
    );
    if (thread) {
      const root = messages
        .get(thread[1])!
        .find((message) => message.id === thread[2]);
      return root
        ? respond({ root, state: root.state, replies: root.thread.preview })
        : respond({}, 404);
    }
    if (/^\/dss\/call\/[^/]+\/active$/.test(path)) return respond(null);
    if (path === '/dss/comms/channels')
      return respond({
        items: (state.omitSidebar ? [] : channels).map((channel) => ({
          id: channel.id,
          name: channel.name,
          channel_type: 'private',
          messaging_binding:
            channel.id === state.groupChannelId
              ? 'whatsapp_group'
              : channel.provider
                ? `${channel.provider}_direct`
                : 'native',
          owner_id: state.activeUser,
          created_at: time(0),
          updated_at: new Date().toISOString(),
          auto_join_team: false,
          is_participant: true,
          participants: [
            {
              channel_id: channel.id,
              user_id: state.activeUser,
              role: 'owner',
              joined_at: time(0),
            },
          ],
        })),
        next_cursor: null,
      });
    if (path === '/dss/channels/preview') return respond({ previews: [] });
    const parent = path.match(/^\/dss\/messages\/channel\/([^/]+)$/);
    if (parent && request.method() === 'GET') {
      const selection = JSON.parse(
        url.searchParams.get('selection') ?? '{}'
      ) as {
        ids?: string[];
      };
      const items = messages
        .get(parent[1])!
        .filter(
          (message) => !selection.ids || selection.ids.includes(message.id)
        );
      return respond({
        items: [...items].reverse(),
        next_cursor: null,
        previous_cursor: null,
      });
    }
    if (parent && request.method() === 'POST') {
      const input = request.postDataJSON() as {
        content: string;
        id?: string;
        thread_id?: string;
      };
      const value = message(
        parent[1],
        8000 + messages.get(parent[1])!.length,
        input.content
      );
      value.id = input.id ?? value.id;
      value.state.root_id = value.id;
      value.thread_id = input.thread_id ?? null;
      value.created_at = new Date().toISOString();
      value.updated_at = value.created_at;
      if (input.thread_id) {
        const root = messages
          .get(parent[1])!
          .find((message) => message.id === input.thread_id)!;
        root.thread.preview.push(value);
        root.thread.reply_count++;
      } else messages.get(parent[1])!.push(value);
      setTimeout(() => event(value), 100);
      return respond(value);
    }
    if (/^\/dss\/messages\/channel\/[^/]+\/typing$/.test(path))
      return respond({});
    const channelDetail = path.match(/^\/dss\/channels\/([^/]+)$/);
    if (channelDetail && request.method() === 'GET') {
      if (state.metadataError) return respond({}, 503);
      const channel = channels.find(
        (channel) => channel.id === channelDetail[1]
      );
      if (!channel) return respond({}, 404);
      return respond({
        channel_id: channel.id,
        channel_name: channel.name,
        channel_type: 'private',
        auto_join_team: false,
        messaging_binding:
          channel.id === state.groupChannelId
            ? 'whatsapp_group'
            : channel.provider
              ? `${channel.provider}_direct`
              : 'native',
        participants: [
          {
            channel_id: channel.id,
            user_id: state.activeUser,
            role: 'owner',
            joined_at: time(0),
            left_at: null,
          },
        ],
      });
    }
    const participants = path.match(/^\/dss\/channels\/([^/]+)\/participants$/);
    if (participants)
      return respond([
        {
          channel_id: participants[1],
          user_id: state.activeUser,
          role: 'owner',
          joined_at: time(0),
          left_at: null,
        },
      ]);
    if (/^\/dss\/channels\/[^/]+\/bots$/.test(path)) return respond([]);
    if (path === '/auth/user/get_names_with_email')
      return respond({
        names: [
          { id: state.activeUser, first_name: 'Browser', last_name: 'Tester' },
        ],
      });
    const fixture = bootstrapResponses.get(`${request.method()} ${path}`);
    if (fixture)
      return respond(
        JSON.parse(
          JSON.stringify(fixture.body).replaceAll(USER_ID, state.activeUser)
        ),
        fixture.status
      );
    unknown.add(`${request.method()} ${path}`);
    return respond({}, 404);
  });

  async function open(channel: string) {
    await page.goto(`${origin}/app/channel/${channel}`, {
      waitUntil: 'commit',
    });
    await expect(page.locator('[data-channel-message-list]')).toBeVisible({
      timeout: 90000,
    });
  }
  async function expectNoCustomerCalls() {
    await expect(
      page.locator(
        '[data-header-action][aria-label="Call"], [data-header-action][aria-label="Join"]'
      )
    ).toHaveCount(0);
    await expect(page.getByText('Calls', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('A call is active in this channel', { exact: true })
    ).toHaveCount(0);
  }
  const input = page.getByRole('textbox', {
    name: 'External customer reply',
  });
  const sendButton = page.getByRole('button', {
    name: 'Send reply via WhatsApp',
  });
  const picker = page.getByRole('button', {
    name: 'Approved WhatsApp template',
  });
  return {
    origin,
    channels,
    id,
    sends,
    messages,
    unreadReply,
    event,
    message,
    metaRequests,
    settingsAccount,
    otherAccount,
    registrations,
    submissions,
    open,
    expectNoCustomerCalls,
    input,
    sendButton,
    picker,
    state,
    verify: () => {
      assert.deepEqual(errors, []);
      assert.deepEqual([...unknown], []);
    },
  };
}

export const test = baseTest.extend<{
  messaging: Awaited<ReturnType<typeof setupMessaging>>;
}>({
  messaging: async ({ page, context, baseURL }, use) => {
    const fixture = await setupMessaging({ page, context, baseURL });
    await use(fixture);
    fixture.verify();
  },
});
