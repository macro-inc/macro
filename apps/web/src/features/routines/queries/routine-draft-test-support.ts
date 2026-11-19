import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { vi } from 'vitest';
import type { ScheduleDraft } from '../core/draft';
import { draftFromSchedule } from './routine-draft';

vi.mock('@core/component/AI/constant', () => ({
  DEFAULT_MODEL: 'claude-sonnet-4-6',
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

export const cron: ScheduledAction = {
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
  run_visibility: 'unlisted',
  created_at: '2026-09-22T12:00:00Z',
  updated_at: '2026-09-22T12:00:00Z',
  configuration_revision: 1,
};
export const events: ScheduledAction = {
  ...cron,
  trigger: { type: 'events', filters: [{ events: ['document.updated'] }] },
};

export function loadedDraft(action: ScheduledAction): ScheduleDraft {
  const result = draftFromSchedule(action);
  if (!result) throw new Error('Expected an editable draft');
  return result;
}
