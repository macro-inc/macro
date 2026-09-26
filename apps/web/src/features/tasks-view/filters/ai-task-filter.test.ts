import { describe, expect, it, vi } from 'vitest';
import {
  type AiTaskFilterCatalog,
  buildAiTaskFilterRequest,
  buildAiTaskFilterResponseFormat,
  buildAiTaskFilterSystemPrompt,
  parseAiTaskFilterResponse,
} from './ai-task-filter';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@notifications', async () => await import('@notifications/types'));

// The soup barrel these pull in transitively imports the websocket client
// modules, which open real sockets at module scope and reject under jsdom.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const CATALOG: AiTaskFilterCatalog = {
  people: [
    { id: 'user-me', label: 'Wolf (me)' },
    { id: 'user-teo', label: 'Teo' },
  ],
  tags: [
    { id: 'tag-dev', label: 'Dev' },
    { id: 'tag-design', label: 'Design' },
  ],
};

const reply = (value: unknown) => JSON.stringify(value);

describe('buildAiTaskFilterRequest', () => {
  it('lists every selectable option with its id in the system prompt', () => {
    const prompt = buildAiTaskFilterSystemPrompt(CATALOG);

    for (const line of [
      '- not-started: Not started',
      '- completed: Completed',
      '- urgent: Urgent',
      '- low: Low',
      '- user-me: Wolf (me)',
      '- user-teo: Teo',
      '- tag-dev: Dev',
    ]) {
      expect(prompt).toContain(line);
    }
  });

  it('marks empty catalogs instead of omitting the group', () => {
    const prompt = buildAiTaskFilterSystemPrompt({ people: [], tags: [] });
    expect(prompt).toContain('assigned. Available:\n(none)');
    expect(prompt).toContain('at least one of them. Available:\n(none)');
  });

  it('asks for strict JSON constrained to the known status and priority ids', () => {
    const format = buildAiTaskFilterResponseFormat();
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);

    const schema = format.json_schema.schema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { items?: { enum?: string[] } }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'status',
        'priority',
        'assignees',
        'createdBy',
        'tags',
        'search',
        'unresolved',
      ])
    );
    expect(schema.properties.status?.items?.enum).toEqual([
      'not-started',
      'in-progress',
      'in-review',
      'completed',
      'canceled',
    ]);
    expect(schema.properties.priority?.items?.enum).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
    ]);
    expect(schema.properties.assignees?.items?.enum).toBeUndefined();
  });

  it('sends the trimmed query as the user turn with a deterministic model call', () => {
    const request = buildAiTaskFilterRequest('  high priority only ', CATALOG);
    expect(request.temperature).toBe(0);
    expect(request.messages.at(-1)).toEqual({
      role: 'user',
      content: 'high priority only',
    });
    expect(request.response_format?.type).toBe('json_schema');
  });
});

describe('parseAiTaskFilterResponse', () => {
  it('maps a well-formed reply onto the tasks facet selection', () => {
    const result = parseAiTaskFilterResponse(
      reply({
        status: ['in-progress', 'in-review'],
        priority: ['high', 'urgent'],
        assignees: ['user-me'],
        createdBy: ['user-teo'],
        tags: ['tag-dev'],
        search: '',
        unresolved: '',
      }),
      CATALOG
    );

    expect(result).toEqual({
      ok: true,
      plan: {
        facets: {
          status: ['in-progress', 'in-review'],
          priority: ['high', 'urgent'],
          assignees: ['user-me'],
          'created-by': ['user-teo'],
          tags: ['tag-dev'],
        },
        search: undefined,
        unresolved: undefined,
      },
    });
  });

  it('drops unknown ids and deduplicates while keeping the rest of the plan', () => {
    const result = parseAiTaskFilterResponse(
      reply({
        status: ['completed', 'archived', 'completed'],
        priority: [],
        assignees: ['user-nobody'],
        createdBy: [],
        tags: ['tag-dev', 'tag-missing'],
        search: '',
        unresolved: 'No one named Nobody was found.',
      }),
      CATALOG
    );

    expect(result).toEqual({
      ok: true,
      plan: {
        facets: { status: ['completed'], tags: ['tag-dev'] },
        search: undefined,
        unresolved: 'No one named Nobody was found.',
      },
    });
  });

  it('accepts labels in place of ids, ignoring case and whitespace', () => {
    const result = parseAiTaskFilterResponse(
      reply({
        status: ['Not started'],
        priority: ['URGENT'],
        assignees: [' teo '],
        createdBy: [],
        tags: ['design'],
        search: '',
        unresolved: '',
      }),
      CATALOG
    );

    expect(result.ok && result.plan.facets).toEqual({
      status: ['not-started'],
      priority: ['urgent'],
      assignees: ['user-teo'],
      tags: ['tag-design'],
    });
  });

  it('keeps a trimmed search term as part of the plan', () => {
    const result = parseAiTaskFilterResponse(
      reply({
        status: [],
        priority: [],
        assignees: [],
        createdBy: [],
        tags: [],
        search: '  billing  ',
        unresolved: '',
      }),
      CATALOG
    );

    expect(result).toEqual({
      ok: true,
      plan: { facets: {}, search: 'billing', unresolved: undefined },
    });
  });

  it('reports a reply that maps to nothing, carrying the model explanation', () => {
    const result = parseAiTaskFilterResponse(
      reply({
        status: [],
        priority: [],
        assignees: [],
        createdBy: [],
        tags: [],
        search: '',
        unresolved: 'Tasks cannot be filtered by due date.',
      }),
      CATALOG
    );

    expect(result).toEqual({
      ok: false,
      error: 'NO_FILTERS',
      unresolved: 'Tasks cannot be filtered by due date.',
    });
  });

  it('rejects missing, malformed, or non-object replies', () => {
    expect(parseAiTaskFilterResponse(undefined, CATALOG)).toEqual({
      ok: false,
      error: 'INVALID_JSON',
    });
    expect(parseAiTaskFilterResponse('not json', CATALOG)).toEqual({
      ok: false,
      error: 'INVALID_JSON',
    });
    expect(parseAiTaskFilterResponse('["high"]', CATALOG)).toEqual({
      ok: false,
      error: 'INVALID_JSON',
    });
  });
});
