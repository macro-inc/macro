import { describe, expect, it } from 'vitest';
import { buildSyncLanes, type SyncPlanHost } from './plan';

const NOW = new Date('2026-11-02T12:00:00.000Z');

const host: SyncPlanHost = {
  syncState: async () => [],
  calendarRange: async () => {
    throw new Error('calendar windows are off in these plans');
  },
};

describe('buildSyncLanes skipLanes', () => {
  it('leaves out the named lanes and keeps the rest in order', async () => {
    const all = (
      await buildSyncLanes(host, 'first', { now: NOW, calendar: false })
    ).map((lane) => lane.id);
    const [skipped, ...rest] = all;
    expect(skipped).toBeDefined();

    const lanes = await buildSyncLanes(host, 'first', {
      now: NOW,
      calendar: false,
      skipLanes: new Set([skipped as string]),
    });

    expect(lanes.map((lane) => lane.id)).toEqual(rest);
  });
});
