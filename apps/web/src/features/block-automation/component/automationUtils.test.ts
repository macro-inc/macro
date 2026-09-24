import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDraft,
  draftFromSchedule,
  draftToCreateBody,
  draftToUpdateBody,
  scheduleToDuplicateBody,
} from './automationUtils';

vi.mock('@core/component/AI/constant', () => ({
  DEFAULT_MODEL: 'claude-sonnet-4-6',
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New automation',
}));

const cron: ScheduledAction = {
  id: 'cron-id',
  owner: 'macro|owner@example.com',
  name: 'Weekly summary',
  kind: 'Agent',
  trigger: {
    type: 'cron',
    schedule: '0 30 10 * * 2,4',
    timezone: 'America/New_York',
  },
  task: {
    model: 'claude-sonnet-4-6',
    user_prompt: 'Summarize updates',
    prompt: '',
  },
  enabled: true,
  created_at: '2026-09-22T12:00:00Z',
  updated_at: '2026-09-22T12:00:00Z',
  configuration_revision: 1,
};
const events: ScheduledAction = {
  ...cron,
  trigger: { type: 'events', filters: [{ events: ['document.updated'] }] },
};

// Cached responses from before tagged triggers were introduced.
const { trigger: _trigger, ...common } = cron;
const legacy = {
  ...common,
  schedule: '0 30 10 * * 2,4',
  timezone: 'America/New_York',
} as unknown as ScheduledAction;

function draft() {
  return {
    ...createEmptyDraft(),
    name: ' Summary ',
    prompt: ' Summarize updates ',
  };
}

describe('cron automation payloads', () => {
  it('creates a canonical trigger without legacy fields', () => {
    const body = draftToCreateBody(draft());
    expect(body).toMatchObject({
      name: 'Summary',
      trigger: { type: 'cron', schedule: '0 0 9 * * 2,3,4,5,6' },
      task: { user_prompt: 'Summarize updates' },
    });
    expect(body).not.toHaveProperty('schedule');
    expect(body).not.toHaveProperty('timezone');
  });

  it.each([cron, legacy])(
    'loads and updates cron while preserving its timezone',
    (action) => {
      expect(draftFromSchedule(action)).toMatchObject({
        time: '10:30',
        daysOfWeek: ['2', '4'],
        prompt: 'Summarize updates',
      });
      const body = draftToUpdateBody(draft(), action);
      expect(body).toMatchObject({
        trigger: { type: 'cron', timezone: 'America/New_York' },
      });
      expect(body).not.toHaveProperty('schedule');
      expect(body).not.toHaveProperty('timezone');
    }
  );

  it.each([cron, legacy])(
    'duplicates cron without changing its expression or task',
    (action) => {
      expect(scheduleToDuplicateBody(action)).toEqual({
        name: 'Weekly summary copy',
        enabled: true,
        kind: 'Agent',
        task: cron.task,
        trigger: cron.trigger,
      });
    }
  );

  it('duplicates API-written cron expressions losslessly', () => {
    const trigger = {
      type: 'cron' as const,
      schedule: '0 */15 * * * * 2027',
      timezone: 'UTC',
    };
    expect(scheduleToDuplicateBody({ ...cron, trigger })).toMatchObject({
      trigger,
    });
  });

  it.each([events, { ...events, schedule: '0 0 9 * * 2', timezone: 'UTC' }])(
    'never parses, updates, or duplicates an event trigger, even with stale legacy fields',
    (action) => {
      expect(draftFromSchedule(action)).toBeUndefined();
      expect(draftToUpdateBody(draft(), action)).toBeUndefined();
      expect(scheduleToDuplicateBody(action)).toBeUndefined();
    }
  );

  it('prefers canonical cron fields over deprecated aliases', () => {
    const action = { ...cron, schedule: '0 0 1 * * 1', timezone: 'UTC' };
    expect(draftFromSchedule(action)?.time).toBe('10:30');
    expect(scheduleToDuplicateBody(action)).toMatchObject({
      trigger: cron.trigger,
    });
  });
});
