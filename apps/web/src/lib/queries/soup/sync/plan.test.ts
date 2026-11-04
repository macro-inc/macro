import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CalendarRangeCacheArgs } from '@graphql-cache/protocol';
import type { SyncLanePlan, SyncLaneState } from '@graphql-cache/sync-protocol';
import {
  buildSchema,
  getOperationAST,
  getVariableValues,
  parse,
  validate,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { buildSyncLanes, MAX_SYNC_LANES, type SyncPlanHost } from './plan';

const NOW = new Date('2026-11-02T12:00:00.000Z');

/** A cache with saved lane state and one uncovered gap per requested month. */
function fakeHost(
  states: SyncLaneState[] = [],
  gapsPerMonth = 1
): SyncPlanHost & { rangeCalls: number } {
  const host = {
    rangeCalls: 0,
    async syncState() {
      return states;
    },
    async calendarRange(args: CalendarRangeCacheArgs) {
      host.rangeCalls += 1;
      const step = (args.endMs - args.startMs) / gapsPerMonth;
      return {
        kind: 'range' as const,
        revision: '1' as never,
        occurrenceKeys: [],
        gaps: Array.from({ length: gapsPerMonth }, (_, index) => ({
          kind: 'timed' as const,
          start: args.startMs + index * step,
          end: args.startMs + (index + 1) * step,
        })),
        freshness: { kind: 'fresh' } as never,
        uncertainEventKeys: [],
        optimistic: false,
        watermark: null,
      };
    },
  };
  return host;
}

function lane(lanes: SyncLanePlan[], id: string): SyncLanePlan {
  const found = lanes.find((item) => item.id === id);
  if (!found) throw new Error(`no lane ${id}`);
  return found;
}

function initial(plan: SyncLanePlan) {
  return (plan.variables.input as { initial: Record<string, unknown> }).initial;
}

const state = (
  overrides: Partial<SyncLaneState> & { id: string }
): SyncLaneState => ({
  nextVariables: null,
  pages: 0,
  items: 0,
  passStartedAt: null,
  completedAt: null,
  watermark: null,
  coverage: null,
  ...overrides,
});

describe('first pass', () => {
  it('lists every lane in load order with its kind, sort and coverage', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    expect(lanes.map((plan) => plan.id)).toEqual([
      'contacts',
      'channels',
      'tasks',
      'task-projects',
      'email-recent',
      'email-shared',
      'documents-recent',
      'calendar-near-0',
      'calendar-near-1',
      'calendar-near-2',
      'calendar-near-3',
      'calendar-near-4',
      'tasks-ids',
      'task-projects-ids',
      'contacts-ids',
      'channels-ids',
      'documents-ids',
      'email-shared-ids',
    ]);
    const tasks = lane(lanes, 'tasks');
    expect(tasks.kind).toEqual({ kind: 'hydrate' });
    expect(tasks.coverage).toEqual({ entity: 'task', scope: 'all' });
    expect(tasks.operationName).toBe('SoupBackfillSyncTasks');
    expect(tasks.paging).toBe('soup');
    expect(initial(tasks).sortMethod).toBe('UPDATED_AT');
    expect(
      (initial(tasks).filters as Record<string, unknown>).documentFilter
    ).toEqual({
      literal: { subType: 'TASK' },
    });
    expect(
      (initial(tasks).filters as Record<string, unknown>).chatFilter
    ).toEqual({
      literal: { chatId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(lane(lanes, 'documents-recent').maxItems).toBe(1000);
    expect(initial(lane(lanes, 'documents-recent')).sortMethod).toBe(
      'VIEWED_UPDATED'
    );
    expect(
      (
        initial(lane(lanes, 'documents-recent')).filters as Record<
          string,
          unknown
        >
      ).documentFilter
    ).toEqual({ not: { literal: { subType: 'TASK' } } });
    expect(lane(lanes, 'calendar-near-0').kind.kind).toBe('calendar');
    expect(lane(lanes, 'calendar-near-0').paging).toBe('calendar');
    expect(lane(lanes, 'tasks-ids').kind).toEqual({
      kind: 'membership',
      scopes: ['tasks'],
    });
    expect(lane(lanes, 'task-projects').coverage).toEqual({
      entity: 'initiative',
      scope: 'all',
    });
    expect(lane(lanes, 'task-projects-ids').kind).toEqual({
      kind: 'membership',
      scopes: ['task-projects'],
    });
    expect(initial(lane(lanes, 'task-projects-ids')).sortMethod).toBe(
      'CREATED_AT'
    );
    expect(lane(lanes, 'documents-ids').kind).toEqual({
      kind: 'membership',
      scopes: ['documents-recent', 'documents-rest'],
    });
    for (const plan of lanes)
      expect(plan.passStartedAt).toBe('2026-11-02T12:00:00.000Z');
  });

  it('reads recent email from the ALL view for 60 days in one lane', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    const email = initial(lane(lanes, 'email-recent'));
    expect(lane(lanes, 'email-recent').operationName).toBe('SoupMailBackfill');
    expect(email.emailView).toBe('ALL');
    expect(email.sortMethod).toBe('UPDATED_AT');
    expect((email.filters as Record<string, unknown>).emailFilter).toEqual({
      // Both importance classes: no `importance` literal.
      tree: { literal: { updatedAt: { gte: '2026-09-03T12:00:00.000Z' } } },
    });
  });

  it('commits calendar windows with the coverage they fetch', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    const calendar = lane(lanes, 'calendar-near-0');
    expect(calendar.operationName).toBe('CalendarOccurrences');
    const input = calendar.variables.input as Record<string, unknown>;
    expect(input.first).toBe(2000);
    expect(input.start).toEqual(expect.any(String));
    expect(calendar.kind).toEqual({
      kind: 'calendar',
      coverage: [
        {
          kind: 'timed',
          start: Date.parse(input.start as string),
          end: Date.parse(input.end as string),
        },
        { kind: 'allDay', start: expect.any(Number), end: expect.any(Number) },
      ],
    });
  });

  it('leaves calendar out when calendars read from REST', async () => {
    const host = fakeHost();
    const lanes = await buildSyncLanes(host, 'first', {
      now: NOW,
      calendar: false,
    });
    expect(lanes.some((plan) => plan.id.startsWith('calendar'))).toBe(false);
    expect(host.rangeCalls).toBe(0);
  });
});

describe('contacts and channels', () => {
  const NIL = '00000000-0000-0000-0000-000000000000';

  it('streams both lists whole with minimal fields and complete coverage', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    const contacts = lane(lanes, 'contacts');
    expect(contacts.kind).toEqual({ kind: 'hydrate' });
    expect(contacts.coverage).toEqual({ entity: 'contact', scope: 'all' });
    expect(contacts.operationName).toBe('SyncContacts');
    expect(contacts.paging).toBe('soup');
    expect(contacts.variables).toEqual({ input: { initial: { limit: 500 } } });
    // The stream pages `data.user.soup`.
    expect(contacts.query.replace(/\s+/g, ' ')).toContain(
      'soup: contacts(input: $input) { items { __typename id } nextCursor }'
    );

    const channels = lane(lanes, 'channels');
    expect(channels.kind).toEqual({ kind: 'hydrate' });
    expect(channels.coverage).toEqual({ entity: 'channel', scope: 'all' });
    // A `SoupBackfill…` name: incomplete channel rows fail the page.
    expect(channels.operationName).toBe('SoupBackfillSyncChannels');
    expect(initial(channels).sortMethod).toBe('CREATED_AT');
    const filters = initial(channels).filters as Record<string, unknown>;
    // No channel filter: the participant channels `GET /comms/channels` lists.
    expect(filters.channelFilter).toBeUndefined();
    expect(filters.documentFilter).toEqual({ literal: { id: NIL } });
    expect(filters.channelThreadFilter).toEqual({ literal: { threadId: NIL } });
    expect(filters.chatFilter).toEqual({ literal: { chatId: NIL } });
  });

  it('reconciles both lists with ID lanes', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    const contactIds = lane(lanes, 'contacts-ids');
    expect(contactIds.kind).toEqual({
      kind: 'membership',
      scopes: ['contacts'],
    });
    expect(contactIds.operationName).toBe('SyncContactIds');
    expect(contactIds.maxItems).toBeUndefined();
    const channelIds = lane(lanes, 'channels-ids');
    expect(channelIds.kind).toEqual({
      kind: 'membership',
      scopes: ['channels'],
    });
    expect(channelIds.operationName).toBe('SoupSyncChannelIds');
    expect(initial(channelIds).sortMethod).toBe('CREATED_AT');
    expect(
      (initial(channelIds).filters as Record<string, unknown>).channelFilter
    ).toBeUndefined();
    expect(channelIds.query.replace(/\s+/g, ' ')).toContain(
      'items { __typename id }'
    );
  });

  it('re-lists both in full every run, even after they completed', async () => {
    const lanes = await buildSyncLanes(
      fakeHost(
        ['contacts', 'channels'].map((id) =>
          state({
            id,
            nextVariables: { input: { continuation: { cursor: 'old' } } },
            passStartedAt: '2026-11-01T08:00:00.000Z',
            completedAt: '2026-10-31T09:00:00.000Z',
            watermark: '2026-10-31T08:00:00.000Z',
          })
        )
      ),
      'first',
      { now: NOW }
    );
    for (const id of ['contacts', 'channels']) {
      const plan = lane(lanes, id);
      expect(plan.passStartedAt).toBe('2026-11-02T12:00:00.000Z');
      expect('initial' in (plan.variables.input as object)).toBe(true);
    }
    expect(initial(lane(lanes, 'channels')).filters).not.toHaveProperty(
      'documentFilter.and'
    );
  });

  it('selects the minimal channel fields', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    const channels = lane(lanes, 'channels').query.replace(/\s+/g, ' ');
    for (const field of [
      'cacheProjection',
      'notifications { __typename id entityId entityType state }',
      'name',
      'channelType',
      'ownerId',
      'organizationId',
      'teamId',
      'createdAt',
      'updatedAt',
      'viewedAt',
      'interactedAt',
      'isParticipant',
      'autoJoinTeam',
      'agentDm { botId name avatarUrl }',
      'participants { channelId userId role joinedAt leftAt }',
    ])
      expect(channels).toContain(field);
    expect(channels).not.toContain('latestMessage');
  });
});

describe('page sizes', () => {
  it('pages every hydrate and ID lane at 500 except email content', async () => {
    const lanes = [
      ...(await buildSyncLanes(fakeHost(), 'first', { now: NOW })),
      ...(await buildSyncLanes(fakeHost(), 'second', { now: NOW })),
    ];
    const limits = Object.fromEntries(
      lanes
        .filter((plan) => plan.paging === 'soup')
        .map((plan) => [plan.id, initial(plan).limit])
    );
    expect(limits).toEqual({
      tasks: 500,
      'task-projects': 500,
      'email-recent': 500,
      'email-shared': 500,
      'documents-recent': 500,
      contacts: 500,
      channels: 500,
      'tasks-ids': 500,
      'task-projects-ids': 500,
      'contacts-ids': 500,
      'channels-ids': 500,
      'documents-ids': 500,
      'email-shared-ids': 500,
      'crm-contacts': 500,
      'core-rest': 500,
      'documents-rest': 500,
      'email-older': 500,
      'tasks-details': 500,
      'documents-details': 500,
      'email-content': 200,
    });
    expect(
      (lane(lanes, 'calendar-near-0').variables.input as { first: number })
        .first
    ).toBe(2000);
  });
});

describe('shared mail', () => {
  it('refreshes the Shared lane in full every run and reconciles all shared threads', async () => {
    const lanes = await buildSyncLanes(
      fakeHost([
        state({
          id: 'email-shared',
          nextVariables: { input: { continuation: { cursor: 'old' } } },
          passStartedAt: '2026-11-01T08:00:00.000Z',
          completedAt: '2026-10-31T09:00:00.000Z',
          watermark: '2026-10-31T08:00:00.000Z',
        }),
      ]),
      'first',
      { now: NOW }
    );
    const shared = lane(lanes, 'email-shared');
    expect(shared.kind).toEqual({ kind: 'hydrate' });
    expect(shared.operationName).toBe('SoupMailBackfill');
    expect(shared.passStartedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(
      (initial(shared).filters as Record<string, unknown>).emailFilter
    ).toEqual({
      tree: {
        and: {
          left: { literal: { shared: 'ONLY' } },
          right: {
            or: {
              left: {
                and: {
                  left: { literal: { importance: true } },
                  right: {
                    literal: { updatedAt: { gte: '2026-08-04T12:00:00.000Z' } },
                  },
                },
              },
              right: {
                and: {
                  left: { literal: { importance: false } },
                  right: {
                    literal: { updatedAt: { gte: '2026-10-03T12:00:00.000Z' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const ids = lane(lanes, 'email-shared-ids');
    expect(ids.kind).toEqual({ kind: 'membership', scopes: ['email-shared'] });
    expect(initial(ids).sortMethod).toBe('CREATED_AT');
    // No recency window: a thread is deleted only once it is no longer shared.
    expect(
      (initial(ids).filters as Record<string, unknown>).emailFilter
    ).toEqual({
      tree: { literal: { shared: 'ONLY' } },
    });
  });
});

describe('second pass', () => {
  it('lists every lane in load order with its caps', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'second', { now: NOW });
    const ids = lanes.map((plan) => plan.id);
    expect(ids.filter((id) => !id.startsWith('calendar'))).toEqual([
      'crm-contacts',
      'core-rest',
      'documents-rest',
      'email-older',
      'tasks-details',
      'documents-details',
      'email-content',
    ]);
    expect(ids.indexOf('calendar-far-0')).toBe(3);
    expect(ids.filter((id) => id.startsWith('calendar-far'))).toHaveLength(25);
    expect(lane(lanes, 'email-older').maxItems).toBe(10000);
    expect(lane(lanes, 'documents-details').maxItems).toBe(1000);
    expect(lane(lanes, 'documents-rest').maxItems).toBeUndefined();
    expect(lane(lanes, 'documents-rest').coverage).toEqual({
      entity: 'document',
      scope: 'all',
    });
    expect(lane(lanes, 'crm-contacts').operationName).toBe('CrmContacts');
    expect(lane(lanes, 'tasks-details').operationName).toBe('SoupBackfill');
    expect(initial(lane(lanes, 'email-content')).limit).toBe(200);
    const older = initial(lane(lanes, 'email-older')).filters as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(older.emailFilter)).toContain(
      '2025-11-02T12:00:00.000Z'
    );
    const core = initial(lane(lanes, 'core-rest')).filters as Record<
      string,
      unknown
    >;
    expect(core.documentFilter).toEqual({
      literal: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(core.crmCompanyFilter).toBeUndefined();
    expect(core.callFilter).toEqual({
      literal: { callId: '00000000-0000-0000-0000-000000000000' },
    });
  });

  it('caps a stream at the server lane limit by dropping the farthest windows', async () => {
    const lanes = await buildSyncLanes(fakeHost([], 2), 'second', { now: NOW });
    expect(lanes).toHaveLength(MAX_SYNC_LANES);
    const calendar = lanes.filter((plan) => plan.id.startsWith('calendar'));
    expect(calendar).toHaveLength(MAX_SYNC_LANES - 7);
    expect(lanes.at(-1)?.id).toBe('email-content');
  });
});

describe('saved state', () => {
  it('resumes an unfinished pass from its saved variables and start', async () => {
    const nextVariables = {
      input: {
        continuation: { cursor: 'c-7', expand: true, emailView: 'ALL' },
      },
    };
    const lanes = await buildSyncLanes(
      fakeHost([
        state({
          id: 'documents-recent',
          nextVariables,
          pages: 1,
          items: 500,
          passStartedAt: '2026-11-01T08:00:00.000Z',
        }),
      ]),
      'first',
      { now: NOW }
    );
    const documents = lane(lanes, 'documents-recent');
    expect(documents.variables).toEqual(nextVariables);
    expect(documents.passStartedAt).toBe('2026-11-01T08:00:00.000Z');
    // The pass already wrote 500 of its 1,000.
    expect(documents.maxItems).toBe(500);
  });

  it('catches a completed hydrate lane up from its watermark', async () => {
    const lanes = await buildSyncLanes(
      fakeHost([
        state({
          id: 'tasks',
          completedAt: '2026-11-01T09:00:00.000Z',
          watermark: '2026-11-01T08:00:00.000Z',
          coverage: { entity: 'task', scope: 'all' },
        }),
      ]),
      'first',
      { now: NOW }
    );
    const tasks = lane(lanes, 'tasks');
    expect(tasks.passStartedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(
      (initial(tasks).filters as Record<string, unknown>).documentFilter
    ).toEqual({
      and: {
        left: { literal: { subType: 'TASK' } },
        right: { literal: { updatedAt: { gte: '2026-11-01T08:00:00.000Z' } } },
      },
    });
  });

  it('starts a lane without a resume point or watermark fresh', async () => {
    const lanes = await buildSyncLanes(
      fakeHost([state({ id: 'tasks', pages: 3, items: 1500 })]),
      'first',
      { now: NOW }
    );
    const tasks = lane(lanes, 'tasks');
    expect(tasks.passStartedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(
      (initial(tasks).filters as Record<string, unknown>).documentFilter
    ).toEqual({
      literal: { subType: 'TASK' },
    });
  });

  it('always starts membership lanes fresh, by creation time, selecting only ids', async () => {
    const lanes = await buildSyncLanes(
      fakeHost([
        state({
          id: 'tasks-ids',
          nextVariables: { input: { continuation: { cursor: 'old' } } },
          completedAt: '2026-11-01T09:00:00.000Z',
          watermark: '2026-11-01T08:00:00.000Z',
        }),
      ]),
      'first',
      { now: NOW }
    );
    const ids = lane(lanes, 'tasks-ids');
    expect(initial(ids).sortMethod).toBe('CREATED_AT');
    expect(
      (initial(ids).filters as Record<string, unknown>).documentFilter
    ).toEqual({
      literal: { subType: 'TASK' },
    });
    expect(ids.maxItems).toBeUndefined();
    expect(ids.passStartedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(ids.query.replace(/\s+/g, ' ')).toContain('items { __typename id }');
  });

  it('leaves out lanes completed since the run started', async () => {
    const lanes = await buildSyncLanes(
      fakeHost([
        state({
          id: 'crm-contacts',
          completedAt: '2026-11-02T12:05:00.000Z',
          watermark: '2026-11-02T12:01:00.000Z',
        }),
        state({
          id: 'core-rest',
          completedAt: '2026-11-02T11:00:00.000Z',
          watermark: '2026-11-02T10:00:00.000Z',
        }),
      ]),
      'second',
      { now: NOW, completedSince: '2026-11-02T12:00:00.000Z' }
    );
    const ids = lanes.map((plan) => plan.id);
    expect(ids).not.toContain('crm-contacts');
    expect(ids).toContain('core-rest');
  });
});

describe('query text', () => {
  it('sends no client-only directives and keeps the fields they marked', async () => {
    const lanes = [
      ...(await buildSyncLanes(fakeHost(), 'first', { now: NOW })),
      ...(await buildSyncLanes(fakeHost(), 'second', { now: NOW })),
    ];
    for (const plan of lanes) expect(plan.query).not.toContain('@');
    const backfill = lane(lanes, 'task-projects').query;
    expect(backfill).toContain('emailLinks');
    expect(backfill).toContain('cacheProjection');
  });

  it('builds queries and variables the server schema accepts', async () => {
    const schema = buildSchema(
      // Tests run from apps/web.
      readFileSync(
        join(process.cwd(), '../../static_assets/schema.graphql'),
        'utf8'
      )
    );
    const lanes = [
      ...(await buildSyncLanes(fakeHost(), 'first', { now: NOW })),
      ...(await buildSyncLanes(fakeHost(), 'second', { now: NOW })),
    ];
    for (const plan of lanes) {
      const document = parse(plan.query);
      const errors = [...validate(schema, document)];
      const operation = getOperationAST(document, plan.operationName);
      const coerced = getVariableValues(
        schema,
        operation?.variableDefinitions ?? [],
        plan.variables
      );
      if (coerced.errors) errors.push(...coerced.errors);
      expect({
        id: plan.id,
        errors: errors.map((error) => error.message),
      }).toEqual({
        id: plan.id,
        errors: [],
      });
    }
  });

  it('selects the minimal row fields for minimal lanes', async () => {
    const lanes = await buildSyncLanes(fakeHost(), 'first', { now: NOW });
    const tasks = lane(lanes, 'tasks').query.replace(/\s+/g, ' ');
    for (const field of [
      'cacheProjection',
      'name',
      'ownerId',
      'fileType',
      'projectId',
      'viewedAt',
      'deletedAt',
      'isFavorited',
      'subType { __typename ... on GraphqlTaskSubType { isCompleted } }',
      'properties { id propertyDefinitionId value { ...SoupPropertyValueFields } }',
      'notifications { __typename id entityId entityType state }',
      'fragment SoupPropertyValueFields on GraphqlPropertyValue',
    ])
      expect(tasks).toContain(field);
    expect(lane(lanes, 'documents-recent').operationName).toBe(
      'SoupBackfillSyncDocuments'
    );
  });
});
