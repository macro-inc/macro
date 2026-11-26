import { describe, expect, test } from 'bun:test';
import { AgentSession } from '../src/entities/agent-sessions/agent-session';
import { CalendarNamespace } from '../src/entities/calendar/namespace';
import { CallRecordNamespace } from '../src/entities/calls/namespace';
import { Channel } from '../src/entities/channels/channel';
import { ChannelNamespace } from '../src/entities/channels/namespace';
import { ChatNamespace } from '../src/entities/chats/namespace';
import { CrmNamespace } from '../src/entities/crm/namespace';
import { CrmPipeline } from '../src/entities/crm/pipeline';
import { DocumentNamespace } from '../src/entities/documents/namespace';
import { EmailNamespace } from '../src/entities/email/namespace';
import { ExternalChat } from '../src/entities/external-chat/chat';
import { Initiative } from '../src/entities/initiatives/initiative';
import { InitiativeNamespace } from '../src/entities/initiatives/namespace';
import { NotificationNamespace } from '../src/entities/notifications/namespace';
import { PasswordNamespace } from '../src/entities/passwords/namespace';
import { ProjectNamespace } from '../src/entities/projects/namespace';
import { SavedViewsNamespace } from '../src/entities/saved-views/namespace';
import { SearchNamespace } from '../src/entities/search/namespace';
import { TaskNamespace } from '../src/entities/tasks/namespace';
import { Team } from '../src/entities/teams/team';
import { WorkspaceNamespace } from '../src/entities/workspace/namespace';
import type { MacroClient } from '../src/utils/client';

/** A client that records every service call and serves nothing. */
function recordingClient() {
  const calls: string[] = [];
  const service = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, method) => async () => {
          calls.push(`${name}.${String(method)}`);
          throw new Error(`unexpected ${name}.${String(method)}`);
        },
      },
    );
  const client = new Proxy(
    { webAppUrl: 'https://macro.example.test' },
    {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : service(String(key)),
    },
  ) as unknown as MacroClient;
  return { client, calls };
}

// biome-ignore lint/suspicious/noExplicitAny: an unknown key is the point.
const bogus: any = { total: 15 };

const iterators: Record<
  string,
  (client: MacroClient) => AsyncIterable<unknown>
> = {
  'channels.list': (c) => new ChannelNamespace(c).list(bogus),
  'channels.search': (c) => new ChannelNamespace(c).search('q', bogus),
  'channel.messages': (c) => Channel.byId(c, 'channel').messages(bogus),
  'channel.messagesAfter': (c) =>
    Channel.byId(c, 'channel').messagesAfter('2026-01-01', bogus),
  'channel.attachments': (c) => Channel.byId(c, 'channel').attachments(bogus),
  'documents.recent': (c) => new DocumentNamespace(c).recent(bogus),
  'documents.trashed': (c) => new DocumentNamespace(c).trashed(bogus),
  'documents.search': (c) => new DocumentNamespace(c).search('q', bogus),
  'tasks.search': (c) => new TaskNamespace(c).search('q', bogus),
  'projects.search': (c) => new ProjectNamespace(c).search('q', bogus),
  'calls.search': (c) => new CallRecordNamespace(c).search('q', bogus),
  'chats.search': (c) => new ChatNamespace(c).search('q', bogus),
  'crm.searchCompanies': (c) => new CrmNamespace(c).searchCompanies('q', bogus),
  'crm.emailPrivacy.history': (c) =>
    new CrmNamespace(c).emailPrivacy.history(bogus),
  'crm.emailPrivacy.excludedThreads': (c) =>
    new CrmNamespace(c).emailPrivacy.excludedThreads(bogus),
  'email.inbox': (c) => new EmailNamespace(c).inbox(bogus),
  'email.scheduled': (c) => new EmailNamespace(c).scheduled(bogus),
  'email.reminders': (c) => new EmailNamespace(c).reminders(bogus),
  'email.search': (c) => new EmailNamespace(c).search('q', bogus),
  'notifications.list': (c) => new NotificationNamespace(c).list(bogus),
  'savedViews.list': (c) => new SavedViewsNamespace(c).list(bogus),
  'search.all': (c) => new SearchNamespace(c).all('q', bogus),
  'workspace.list': (c) => new WorkspaceNamespace(c).list(bogus),
  'initiatives.list': (c) => new InitiativeNamespace(c).list(bogus),
  'initiative.activity': (c) =>
    Initiative.byId(c, 'initiative').activity(bogus),
  'calendar.occurrences': (c) =>
    new CalendarNamespace(c).occurrences({
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-02T00:00:00Z',
      ...bogus,
    }),
  'agentSession.activity': (c) =>
    AgentSession.byId(c, 'session').activity(bogus),
  'invocation.activity': (c) =>
    AgentSession.byId(c, 'session')
      .invocations.byId('invocation')
      .activity(bogus),
  'channels.search (blank)': (c) => new ChannelNamespace(c).search(' ', bogus),
  'externalChat.messages': (c) => ExternalChat.byId(c, 'chat').messages(bogus),
  'pipeline.rows': (c) => CrmPipeline.byId(c, 'pipeline').rows(bogus),
  'pipeline.queryRows': (c) => CrmPipeline.byId(c, 'pipeline').queryRows(bogus),
  'passwords.search': (c) =>
    new PasswordNamespace(c)
      .forAgent(Team.byId(c, 'team'), { wake: 'wake' })
      .search('q', bogus),
};

async function first(make: () => AsyncIterable<unknown>) {
  for await (const item of make()) return item;
}

describe('auto-paginating iterators', () => {
  for (const [name, make] of Object.entries(iterators)) {
    test(`${name} rejects an option it does not take, naming maxItems`, async () => {
      const { client, calls } = recordingClient();

      const error = await first(() => make(client)).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(String(error)).toContain('does not take');
      expect(String(error)).toContain('`maxItems`');
      expect(calls).toEqual([]);
    });
  }
});

test.each([
  [
    'email.inbox',
    (c: MacroClient) => new EmailNamespace(c).inbox({ limit: 15 } as never),
    '`pageSize`, `sort`, `maxItems`',
  ],
  [
    'documents.recent',
    (c: MacroClient) => new DocumentNamespace(c).recent({ limit: 50 } as never),
    '`pageSize`, `fileType`, `maxItems`',
  ],
])('%s rejects a total `limit` and names the options it takes', async (_, make, options) => {
  const { client, calls } = recordingClient();

  const error = await first(() => make(client)).then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(String(error)).toContain('does not take `');
  expect(String(error)).toContain(`its options are ${options}`);
  expect(calls).toEqual([]);
});

describe('maxItems', () => {
  test('email.inbox stops fetching once it has yielded maxItems threads', async () => {
    const requests: unknown[] = [];
    const client = {
      email: {
        previewsInboxCursor: async (options: {
          query: { cursor?: string };
        }) => {
          requests.push(options.query);
          const start = Number(options.query.cursor ?? 0);
          return {
            data: {
              items: Array.from({ length: 10 }, (_, i) => ({
                id: `thread-${start + i}`,
                isRead: false,
                inboxVisible: true,
                linkId: 'link',
              })),
              next_cursor: start < 40 ? String(start + 10) : null,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const threads = await Array.fromAsync(
      new EmailNamespace(client).inbox({ pageSize: 10, maxItems: 15 }),
    );

    expect(threads).toHaveLength(15);
    expect(requests).toHaveLength(2);
  });

  test('channels.list fetches one page for a maxItems inside it', async () => {
    let requests = 0;
    const client = {
      storage: {
        getChannels: async () => {
          requests++;
          const last = requests >= 5;
          return {
            data: {
              items: Array.from({ length: 100 }, (_, i) => ({
                id: `channel-${i}`,
                channel_type: 'public',
                name: `Channel ${i}`,
              })),
              next_cursor: last ? null : `page-${requests}`,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const channels = await Array.fromAsync(
      new ChannelNamespace(client).list({ maxItems: 3 }),
    );

    expect(channels.map((c) => c.id)).toEqual([
      'channel-0',
      'channel-1',
      'channel-2',
    ]);
    expect(requests).toBe(1);
  });

  test('per-type search honours maxItems', async () => {
    let requests = 0;
    const client = {
      search: {
        unifiedSearch: async () => {
          requests++;
          const last = requests >= 5;
          return {
            data: {
              results: Array.from({ length: 5 }, (_, i) => ({
                type: 'channel',
                id: `channel-${requests}-${i}`,
                channel_id: `channel-${requests}-${i}`,
                channel_type: 'public',
                highlight: { content: [] },
              })),
              next_cursor: last ? null : `page-${requests}`,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const channels = await Array.fromAsync(
      new ChannelNamespace(client).search('q', { maxItems: 2 }),
    );

    expect(channels).toHaveLength(2);
    expect(requests).toBe(1);
  });

  for (const maxItems of [0, -1, 1.5, Number.NaN]) {
    test(`rejects maxItems ${maxItems}`, async () => {
      const { client, calls } = recordingClient();

      const error = await first(() =>
        new ChannelNamespace(client).list({ maxItems }),
      ).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(String(error)).toContain('maxItems');
      expect(calls).toEqual([]);
    });
  }
});
