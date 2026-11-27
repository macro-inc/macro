import { describe, expect, test } from 'bun:test';
import { CallRecordNamespace } from '../src/entities/calls/namespace';
import { ChannelNamespace } from '../src/entities/channels/namespace';
import { ChatNamespace } from '../src/entities/chats/namespace';
import { CrmNamespace } from '../src/entities/crm/namespace';
import { DocumentNamespace } from '../src/entities/documents/namespace';
import { EmailNamespace } from '../src/entities/email/namespace';
import { ProjectNamespace } from '../src/entities/projects/namespace';
import { TaskNamespace } from '../src/entities/tasks/namespace';
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

async function first(make: () => AsyncIterable<unknown>) {
  for await (const item of make()) return item;
}

// Each search, called with a blank query, and the listing its error names.
const searches: Record<
  string,
  {
    search: (client: MacroClient, query: string) => AsyncIterable<unknown>;
    listing: string;
  }
> = {
  'projects.search': {
    search: (c, q) => new ProjectNamespace(c).search(q),
    listing: "macro.workspace.list({ includeTypes: ['project'] })",
  },
  'tasks.search': {
    search: (c, q) => new TaskNamespace(c).search(q),
    listing:
      "macro.workspace.list({ includeTypes: ['document'], df: { l: { dst: 'task' } } })",
  },
  'documents.search': {
    search: (c, q) => new DocumentNamespace(c).search(q),
    listing: 'macro.documents.recent()',
  },
  'email.search': {
    search: (c, q) => new EmailNamespace(c).search(q),
    listing: 'macro.email.inbox()',
  },
  'calls.search': {
    search: (c, q) => new CallRecordNamespace(c).search(q),
    listing: "macro.workspace.list({ includeTypes: ['call'] })",
  },
  'chats.search': {
    search: (c, q) => new ChatNamespace(c).search(q),
    listing: "macro.workspace.list({ includeTypes: ['ai_chat'] })",
  },
  'channels.search': {
    search: (c, q) =>
      new ChannelNamespace(c).search(q, { searchOn: 'content' }),
    listing: 'macro.channels.list()',
  },
};

describe('a per-type search with a blank query', () => {
  for (const [method, { search, listing }] of Object.entries(searches)) {
    for (const query of ['', '   ']) {
      test(`${method}(${JSON.stringify(query)}) throws before any request, naming ${listing}`, async () => {
        const { client, calls } = recordingClient();

        const error = await first(() => search(client, query)).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(String(error)).toContain(`${method} needs words to search for`);
        expect(String(error)).toContain(listing);
        expect(calls).toEqual([]);
      });
    }
  }

  test('crm.searchCompanies says there is no listing to use instead', async () => {
    const { client, calls } = recordingClient();

    const error = await first(() =>
      new CrmNamespace(client).searchCompanies(''),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(String(error)).toContain(
      'crm.searchCompanies needs words to search for',
    );
    expect(calls).toEqual([]);
  });

  test('a query with words still searches', async () => {
    const requests: string[] = [];
    const client = {
      search: {
        unifiedSearch: async (options: { body: { query: string } }) => {
          requests.push(options.body.query);
          return { data: { results: [], next_cursor: null } };
        },
      },
    } as unknown as MacroClient;

    await first(() => new ProjectNamespace(client).search(' roadmap '));

    expect(requests).toEqual([' roadmap ']);
  });
});
