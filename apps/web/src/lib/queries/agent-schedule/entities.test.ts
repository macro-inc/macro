import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
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

describe('cron-only automation entities', () => {
  it('converts canonical cron actions and preserves run state', () => {
    expect(
      scheduleToEntity({ ...cron, claimed: new Date().toISOString() })
    ).toMatchObject({
      id: 'cron-id',
      type: 'automation',
      cron: '0 0 9 * * 2',
      nextRunAt: cron.next_run_at,
      isRunning: true,
    });
    expect(
      scheduleToEntity({ ...cron, claimed: '2020-01-01T00:00:00Z' })?.isRunning
    ).toBe(false);
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
