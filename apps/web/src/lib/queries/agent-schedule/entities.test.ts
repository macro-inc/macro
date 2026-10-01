import type { RoutineStatus } from '@entity/types/entity';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleToEntity, useAutomationEntities } from './entities';
import { getCronTrigger } from './triggers';

const query = vi.hoisted(() => ({
  isSuccess: true,
  isPending: false,
  items: [] as ScheduledAction[],
  get data() {
    return this.items;
  },
}));
vi.mock('./schedules', () => ({ useSchedulesQuery: () => query }));

const cron: ScheduledAction = {
  id: 'cron-id',
  owner: 'macro|owner@example.com',
  name: 'Summary',
  kind: 'Agent',
  trigger: { type: 'cron', schedule: '0 0 9 * * 2', timezone: 'UTC' },
  task: {},
  enabled: true,
  configuration_revision: 1,
  created_at: '2026-09-22T12:00:00Z',
  updated_at: '2026-09-22T12:00:00Z',
  next_run_at: '2026-09-28T09:00:00Z',
};
const events: ScheduledAction = {
  ...cron,
  id: 'event-id',
  next_run_at: null,
  trigger: { type: 'events', filters: [{ events: ['document.updated'] }] },
};

describe('routine status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<{
    name: string;
    fields: Partial<ScheduledAction>;
    status: RoutineStatus;
  }>([
    {
      name: 'a fresh claim as running',
      fields: { claimed: '2026-09-28T11:55:00Z' },
      status: { kind: 'running' },
    },
    {
      name: 'a run that outlives its pause as running',
      fields: { claimed: '2026-09-28T11:55:00Z', enabled: false },
      status: { kind: 'running' },
    },
    {
      name: 'a stale claim as scheduled',
      fields: { claimed: '2026-09-28T11:35:00Z' },
      status: { kind: 'scheduled', nextRunAt: '2026-09-28T09:00:00Z' },
    },
    {
      name: 'a paused routine with a leftover next run as paused',
      fields: { enabled: false },
      status: { kind: 'paused' },
    },
    {
      name: 'an active routine without a next run as unscheduled',
      fields: { next_run_at: null },
      status: { kind: 'unscheduled' },
    },
  ])('reports $name', ({ fields, status }) => {
    expect(scheduleToEntity({ ...cron, ...fields })?.status).toEqual(status);
  });
});

describe('cron-only automation entities', () => {
  it('converts canonical cron actions', () => {
    expect(scheduleToEntity(cron)).toEqual({
      id: 'cron-id',
      type: 'automation',
      name: 'Summary',
      ownerId: 'macro|owner@example.com',
      createdAt: '2026-09-22T12:00:00Z',
      updatedAt: '2026-09-22T12:00:00Z',
      cron: '0 0 9 * * 2',
      status: { kind: 'scheduled', nextRunAt: '2026-09-28T09:00:00Z' },
    });
  });

  it('omits events and actions without an id', () => {
    expect(scheduleToEntity(events)).toBeUndefined();
    expect(scheduleToEntity({ ...cron, id: null })).toBeUndefined();
    expect(
      scheduleToEntity({
        ...events,
        schedule: '0 0 9 * * 2',
        timezone: 'UTC',
      } as ScheduledAction)
    ).toBeUndefined();
  });

  it('accepts legacy cached cron actions through the compatibility helper', () => {
    const { trigger: _trigger, ...common } = cron;
    const legacy = { ...common, schedule: '0 0 9 * * 2', timezone: 'UTC' };
    expect(getCronTrigger(legacy)).toEqual(cron.trigger);
    expect(scheduleToEntity(legacy as unknown as ScheduledAction)?.cron).toBe(
      legacy.schedule
    );
    expect(getCronTrigger({ schedule: legacy.schedule })).toBeUndefined();
    expect(getCronTrigger({ timezone: 'UTC' })).toBeUndefined();
    expect(getCronTrigger({ schedule: null, timezone: null })).toBeUndefined();
  });

  it('filters events from mixed API/cache lists', () => {
    query.isSuccess = true;
    query.items = [events, cron];
    createRoot((dispose) => {
      expect(useAutomationEntities()().map((entity) => entity.id)).toEqual([
        'cron-id',
      ]);
      dispose();
    });
  });

  it('does not read pending query data or suspend a list', () => {
    query.isSuccess = false;
    query.isPending = true;
    const data = vi.spyOn(query, 'data', 'get').mockImplementation(() => {
      throw new Error('Pending resource read');
    });
    createRoot((dispose) => {
      expect(useAutomationEntities()()).toEqual([]);
      dispose();
    });
    data.mockRestore();
    query.isSuccess = true;
    query.isPending = false;
  });

  it('retains cached cron entities after a refetch error, excluding event routines', () => {
    query.isSuccess = false;
    query.items = [events, cron];
    createRoot((dispose) => {
      expect(useAutomationEntities()().map((entity) => entity.id)).toEqual([
        'cron-id',
      ]);
      dispose();
    });
  });

  it('returns no entities after an initial failure without cached data', () => {
    query.isSuccess = false;
    query.items = [];
    createRoot((dispose) => {
      expect(useAutomationEntities()()).toEqual([]);
      dispose();
    });
  });
});
