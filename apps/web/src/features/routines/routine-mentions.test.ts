import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useRoutineMentionSource } from './routine-mentions';

const { rows } = vi.hoisted(() => ({ rows: [] as ScheduledAction[] }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableRoutineSharing: {},
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'owner',
}));
vi.mock('./queries/schedules', () => ({
  useSchedulesQuery: () => ({ isPending: false, data: rows }),
}));

it('offers only owned routines that can publish a channel mention', () => {
  const routine: ScheduledAction = {
    id: 'plain',
    name: 'Reminder',
    owner: 'owner',
    kind: 'Agent',
    enabled: true,
    run_visibility: 'unlisted',
    configuration_revision: 1,
    trigger: { type: 'once', at: '2026-12-01T09:00:00Z' },
    created_at: '2026-11-01T09:00:00Z',
    updated_at: '2026-11-01T09:00:00Z',
    task: { model: 'model', user_prompt: 'Remind me', prompt: '' },
  };
  rows.push(
    routine,
    { ...routine, id: 'other', owner: 'other' },
    {
      ...routine,
      id: 'copy',
      task: { sub_routine: 'remind', inputs: { item: 'example' } },
    },
    {
      ...routine,
      id: 'parent',
      task: {
        steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
        sub_routines: [
          {
            name: 'remind',
            title: 'Remind me',
            // The current editor cannot decode an agent step without a target.
            steps: [{ type: 'agent', instructions: 'Remind me' }],
          },
        ],
      },
    },
    {
      ...routine,
      id: 'detached',
      task: {
        steps: [{ type: 'agent', model: 'model', instructions: 'Remind me' }],
        inputs: [
          { name: 'item', label: 'Item', type: 'text', value: 'example' },
        ],
      },
    }
  );
  createRoot((dispose) => {
    const mentions = useRoutineMentionSource(
      () => 'remind',
      () => true
    );
    expect(mentions().map(({ id }) => id)).toEqual(['plain']);
    dispose();
  });
});
