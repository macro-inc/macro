import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDraft,
  draftFromSchedule,
  draftToCreateBody,
  draftToUpdateBody,
  onceFromCron,
  scheduleToDuplicateBody,
  validateRoutineDraft,
} from './automationUtils';
import type { ScheduleDraft } from './types';

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

function draft(): ScheduleDraft {
  return {
    ...createEmptyDraft(),
    name: ' Summary ',
    prompt: ' Summarize updates ',
  };
}

const agentId = '0195a096-3d24-7000-8000-000000000001';

function loadedDraft(action: ScheduledAction): ScheduleDraft {
  const result = draftFromSchedule(action);
  if (!result) throw new Error('Expected an editable draft');
  return result;
}

describe('routine execution payloads', () => {
  it.each([
    {
      model: 'retired-model',
      target: { kind: 'model', model: 'retired-model' },
    },
    { agent: { bot_id: agentId }, target: { kind: 'agent', agentId } },
    {
      agent: { bot_id: agentId },
      model: null,
      target: { kind: 'agent', agentId },
    },
    {
      agent: { bot_id: agentId },
      model: 'runtime/custom',
      target: { kind: 'agent', agentId, modelOverride: 'runtime/custom' },
    },
  ])(
    'decodes and creates model and agent targets: %j',
    ({ target, ...selection }) => {
      const action = {
        ...cron,
        task: {
          prompt: 'System instructions',
          user_prompt: 'User instructions',
          ...selection,
        },
      };
      const restored = loadedDraft(action);
      expect(restored.target).toEqual(target);
      expect(restored.prompt).toBe('User instructions');
      const created = draftToCreateBody(restored);
      expect(created.task.user_prompt).toBe('User instructions');
      expect(
        draftFromSchedule({ ...action, task: created.task })?.target
      ).toEqual(target);
    }
  );

  it.each([
    {},
    { model: ' ' },
    { model: 42 },
    { agent: {} },
    { agent: { bot_id: 'invalid' }, model: 'valid' },
    { agent: { bot_id: agentId }, model: '' },
    { agent: { bot_id: agentId }, model: [] },
    { model: 'valid', prompt: null },
    { model: 'valid', user_prompt: 42 },
  ])('refuses malformed tasks rather than falling back: %j', (task) => {
    const action = { ...cron, task: { prompt: '', user_prompt: '', ...task } };
    expect(draftFromSchedule(action)).toBeUndefined();
    expect(draftToUpdateBody(draft(), action)).toBeUndefined();
  });

  it.each([
    { model: 'retired-model' },
    { agent: { bot_id: agentId, future_setting: true } },
    { agent: { bot_id: agentId }, model: null },
    { agent: { bot_id: agentId }, model: 'runtime/custom' },
  ])(
    'preserves exact task and configuration for unedited drafts: %j',
    (selection) => {
      const action = {
        ...cron,
        name: ' Untrimmed name ',
        trigger: {
          type: 'cron' as const,
          schedule: '0 */15 * * * * 2027',
          timezone: 'UTC',
        },
        task: {
          future: { nested: [1, null, 'value'] },
          prompt: ' System instructions\n',
          user_prompt: ' User instructions\n',
          ...selection,
        },
      };
      const before = JSON.stringify(action.task);
      const body = draftToUpdateBody(loadedDraft(action), action);
      expect(body).toEqual({
        name: action.name,
        trigger: action.trigger,
        kind: action.kind,
        task: action.task,
      });
      expect(JSON.stringify(body?.task)).toBe(before);
      expect(body?.task).toBe(action.task);
      expect(scheduleToDuplicateBody(action)?.task).toBe(action.task);
    }
  );

  it('edits only the user prompt and keeps system instructions and extension fields', () => {
    const action = {
      ...cron,
      task: {
        ...cron.task,
        agent: { bot_id: agentId },
        prompt: 'System instructions',
        extra: { tools: ['search'] },
      },
    };
    const body = draftToUpdateBody(
      { ...loadedDraft(action), prompt: ' New prompt ' },
      action
    );
    expect(body?.task).toEqual({ ...action.task, user_prompt: 'New prompt' });
    expect(action.task).toHaveProperty('user_prompt', 'Summarize updates');
  });

  it('switches model to agent, clears overrides, changes agents, and explicitly switches back', () => {
    const action = {
      ...cron,
      task: { ...cron.task, prompt: 'System instructions', extra: true },
    };
    const initial = loadedDraft(action);
    const agentBody = draftToUpdateBody(
      { ...initial, target: { kind: 'agent', agentId } },
      action
    );
    expect(agentBody?.task).toEqual({
      prompt: 'System instructions',
      user_prompt: 'Summarize updates',
      extra: true,
      agent: { bot_id: agentId },
    });
    if (!agentBody) throw new Error('Expected an update');
    const agentAction = {
      ...action,
      task: { ...agentBody.task, agent: { bot_id: agentId, extra: true } },
    };
    const overrideBody = draftToUpdateBody(
      {
        ...loadedDraft(agentAction),
        target: { kind: 'agent', agentId, modelOverride: 'runtime/custom' },
      },
      agentAction
    );
    expect(overrideBody?.task).toEqual({
      ...agentAction.task,
      model: 'runtime/custom',
    });
    if (!overrideBody) throw new Error('Expected an update');
    const overrideAction = { ...agentAction, task: overrideBody.task };
    const defaultBody = draftToUpdateBody(
      { ...loadedDraft(overrideAction), target: { kind: 'agent', agentId } },
      overrideAction
    );
    expect(defaultBody?.task).not.toHaveProperty('model');
    expect(defaultBody?.task.agent).toEqual(agentAction.task.agent);
    const differentAgentId = '0195a096-3d24-7000-8000-000000000002';
    const changedAgent = draftToUpdateBody(
      {
        ...loadedDraft(overrideAction),
        target: { kind: 'agent', agentId: differentAgentId },
      },
      overrideAction
    );
    expect(changedAgent?.task.agent).toEqual({ bot_id: differentAgentId });
    expect(changedAgent?.task).not.toHaveProperty('model');
    const modelBody = draftToUpdateBody(
      {
        ...loadedDraft(overrideAction),
        target: { kind: 'model', model: 'new-model' },
      },
      overrideAction
    );
    expect(modelBody?.task).toEqual({
      ...overrideAction.task,
      agent: null,
      model: 'new-model',
    });
  });

  it('rejects invalid targets on creation', () => {
    expect(() =>
      draftToCreateBody({ ...draft(), target: { kind: 'model', model: ' ' } })
    ).toThrow();
  });
});

describe('cron automation payloads', () => {
  it('creates a canonical trigger without legacy fields', () => {
    const body = draftToCreateBody(draft());
    expect(body).toMatchObject({
      name: 'Summary',
      enabled: true,
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

  it('retains a legacy cached schedule when adding a channel event', () => {
    const loaded = draftFromSchedule(legacy)!;
    expect(loaded.triggers).toHaveLength(1);
    const body = draftToUpdateBody(
      {
        ...loaded,
        triggers: [
          ...loaded.triggers!,
          { kind: 'event', id: 'new', events: ['channel.message_posted'] },
        ],
      },
      legacy
    );
    expect(body).toMatchObject({
      trigger: {
        type: 'multiple',
        triggers: [
          {
            type: 'cron',
            schedule: '0 30 10 * * 2,4',
            timezone: 'America/New_York',
          },
          { type: 'events', filters: [{ events: ['channel.message_posted'] }] },
        ],
      },
    });
  });

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

  it('keeps a paused routine paused when duplicating it', () => {
    expect(scheduleToDuplicateBody({ ...cron, enabled: false })).toEqual({
      name: 'Weekly summary copy',
      enabled: false,
      kind: 'Agent',
      task: cron.task,
      trigger: cron.trigger,
    });
  });

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
    'edits and duplicates canonical event triggers without using stale legacy cron fields',
    (action) => {
      const loaded = draftFromSchedule(action)!;
      expect(loaded.triggers).toMatchObject([
        { kind: 'event', events: ['document.updated'] },
      ]);
      expect(draftToUpdateBody(loaded, action)).toMatchObject({
        trigger: action.trigger,
      });
      expect(scheduleToDuplicateBody(action)).toMatchObject({
        trigger: action.trigger,
      });
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

describe('one-off routines', () => {
  it('preserves the instant of a year-bounded cron in another timezone', () => {
    const once = onceFromCron('0 0 9 3 10 * 2030', 'America/New_York');
    expect(new Date(once!.onceAt).toISOString()).toBe(
      '2030-10-03T13:00:00.000Z'
    );
  });
  it('keeps an unchanged one-off trigger and its timezone when editing instructions', () => {
    const routine = {
      ...cron,
      trigger: {
        type: 'cron' as const,
        schedule: '12 0 9 3 10 * 2030',
        timezone: 'America/New_York',
      },
    };
    const draft = loadedDraft(routine);
    expect(draft.frequency).toBe('once');
    expect(
      draftToUpdateBody({ ...draft, prompt: 'New instructions' }, routine)
    ).toEqual(expect.objectContaining({ trigger: routine.trigger }));
    const created = draftToCreateBody(draft);
    expect(
      created && 'trigger' in created ? created.trigger : undefined
    ).toEqual({
      type: 'cron',
      schedule: '12 0 13 3 10 * 2030',
      timezone: 'UTC',
    });
  });
  it('rejects past one-off creation but permits editing a completed routine', () => {
    const once = {
      ...draft(),
      frequency: 'once' as const,
      onceAt: '2000-01-01T09:00',
    };
    expect(validateRoutineDraft(once, true)).toBe(
      'Choose a time in the future.'
    );
    expect(validateRoutineDraft(once)).toBeNull();
  });
  it('rejects empty weekdays and invalid timezones', () => {
    expect(
      validateRoutineDraft({ ...draft(), frequency: 'week', daysOfWeek: [] })
    ).toBe('Select at least one day.');
    expect(
      validateRoutineDraft({ ...draft(), timezone: 'Mars/Olympus' })
    ).toContain('valid time zone');
  });
});
