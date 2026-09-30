import type { ReminderEntity } from '@entity/types/entity';
import { describe, expect, it, vi } from 'vitest';
import {
  buildReminderQuery,
  reminderMatchesSearch,
  reminderMatchesStatus,
  reminderStatusFromFacets,
} from './reminder-query';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
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

const NIL = '00000000-0000-0000-0000-000000000000';

function reminder(overrides: Partial<ReminderEntity> = {}): ReminderEntity {
  return {
    type: 'reminder',
    id: 'reminder-a',
    name: 'Follow up',
    description: 'Follow up',
    scheduleType: 'once',
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  } as ReminderEntity;
}

describe('reminder status from facets', () => {
  it('opens on Active, the former standalone view default', () => {
    expect(reminderStatusFromFacets({})).toBe('active');
    expect(reminderStatusFromFacets({ reminders: [] })).toBe('active');
    // Persisted facets preserve unknown ids; those fall back too.
    expect(reminderStatusFromFacets({ reminders: ['someday'] })).toBe('active');
  });

  it('reads the single selected status', () => {
    expect(reminderStatusFromFacets({ reminders: ['scheduled'] })).toBe(
      'scheduled'
    );
    expect(reminderStatusFromFacets({ reminders: ['done'] })).toBe('done');
  });
});

describe('reminder list query', () => {
  it('asks for fired, uncompleted reminders on Active, newest first', () => {
    const { params, body } = buildReminderQuery('active');
    expect(params).toMatchObject({
      sort_method: 'updated_at',
      sort_direction: 'desc',
    });
    expect(JSON.stringify(body.remf)).toContain('"inc"');
    expect(JSON.stringify(body.remf)).toContain('"comp":false');
    expect(JSON.stringify(body.remf)).toContain('"fired":true');
  });

  it('reads Scheduled soonest-first and not yet fired', () => {
    const { params, body } = buildReminderQuery('scheduled');
    expect(params.sort_direction).toBe('asc');
    expect(JSON.stringify(body.remf)).toContain('"comp":false');
    expect(JSON.stringify(body.remf)).toContain('"fired":false');
  });

  it('asks for completed reminders on Done without splitting on fired', () => {
    const { body } = buildReminderQuery('done');
    expect(JSON.stringify(body.remf)).toContain('"comp":true');
    expect(JSON.stringify(body.remf)).not.toContain('fired');
  });

  // Reminders are opt-in server-side; `confine` NIL-excludes every other
  // target, which is the only thing keeping mail out of this list.
  it('keeps every other entity type out of the list', () => {
    const { body } = buildReminderQuery('active');
    expect(JSON.stringify(body.ef)).toContain(NIL);
    expect(JSON.stringify(body.df)).toContain(NIL);
    expect(JSON.stringify(body.chanf)).toContain(NIL);
  });
});

describe('reminder status predicate', () => {
  const fired = reminder();
  const upcoming = reminder({
    id: 'upcoming',
    nextRunAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const done = reminder({ id: 'done', completedAt: '2026-09-20T00:00:00Z' });

  it('mirrors the server split', () => {
    expect(reminderMatchesStatus(fired, 'active')).toBe(true);
    expect(reminderMatchesStatus(upcoming, 'active')).toBe(false);
    expect(reminderMatchesStatus(done, 'active')).toBe(false);

    expect(reminderMatchesStatus(upcoming, 'scheduled')).toBe(true);
    expect(reminderMatchesStatus(fired, 'scheduled')).toBe(false);

    expect(reminderMatchesStatus(done, 'done')).toBe(true);
    expect(reminderMatchesStatus(fired, 'done')).toBe(false);
  });
});

describe('reminder search', () => {
  it('matches the description case-insensitively and ignores blank text', () => {
    const entity = reminder({ name: 'Follow up with Teo' });
    expect(reminderMatchesSearch(entity, '')).toBe(true);
    expect(reminderMatchesSearch(entity, '   ')).toBe(true);
    expect(reminderMatchesSearch(entity, 'teo')).toBe(true);
    expect(reminderMatchesSearch(entity, ' FOLLOW ')).toBe(true);
    expect(reminderMatchesSearch(entity, 'invoice')).toBe(false);
  });
});
