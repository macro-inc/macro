import type {
  DraftedRoutine,
  RoutineStep,
} from '@service-scheduled-action/generated/schemas';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSteps } from '../core/routine-steps';
import { composeRoutine, draftFromRoutine } from './compose-routine';
import { draftToCreateBody } from './routine-draft';

const draftRoutine = vi.hoisted(() => vi.fn());
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { draftRoutine },
}));
vi.mock('@app/features/paywall/ai-usage-limit-handling', () => ({
  handleAiUsageLimitError: () => false,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

const context = {
  timezone: 'America/New_York',
  defaultModel: 'claude',
  labels: ['Finance'],
  tags: [],
  channels: [{ name: 'eng', id: 'channel-1' }],
  folders: [],
  people: [],
  agents: [{ name: 'Researcher', botId: 'bot-1' }],
  decisions: true,
  codeSteps: true,
};

const labelStep: RoutineStep = {
  type: 'code',
  id: 'label_by_topic',
  title: 'Label by topic',
  summary: 'Asks AI which label fits and adds it.',
  source: 'export async function main() {}',
};

const routine = (
  overrides: Partial<DraftedRoutine> = {}
): DraftedRoutine & { outcome: 'routine' } => ({
  outcome: 'routine',
  name: 'Inbox triage',
  trigger: {
    type: 'events' as const,
    filters: [{ events: ['email.message_received' as const] }],
  },
  steps: [labelStep],
  problems: [],
  ...overrides,
});

beforeEach(() => {
  draftRoutine.mockReset();
});

describe('composeRoutine', () => {
  it('asks the scheduler to draft it with what the drafter may write and name', async () => {
    draftRoutine.mockResolvedValue(ok(routine()));

    const draft = await composeRoutine('triage my inbox', context);

    expect(draftRoutine).toHaveBeenCalledWith({
      draft: { type: 'routine', description: 'triage my inbox' },
      context: {
        timezone: 'America/New_York',
        agentModel: 'claude',
        code: true,
        conditions: true,
        workspace: {
          labels: ['Finance'],
          tags: [],
          channels: [{ name: 'eng', id: 'channel-1' }],
          folders: [],
          people: [],
          agents: [{ name: 'Researcher', botId: 'bot-1' }],
        },
      },
    });
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.name).toBe('Inbox triage');
    expect(draft.triggers).toMatchObject([
      { kind: 'event', events: ['email.message_received'] },
    ]);
    expect(draft.steps?.[0]).toMatchObject({
      kind: 'code',
      output: 'label_by_topic',
    });
  });

  it('says why AI couldn’t draft it', async () => {
    draftRoutine.mockResolvedValueOnce(
      ok({ outcome: 'failed', message: 'Describe when it should run.' })
    );
    expect(await composeRoutine('x', context)).toBe(
      'Describe when it should run.'
    );
    draftRoutine.mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR', message: 'boom' }])
    );
    expect(await composeRoutine('x', context)).toBe(
      'Couldn’t draft that routine. Please try again.'
    );
  });
});

describe('a drafted routine in the editor', () => {
  it('keeps a trigger limited to the items it names', () => {
    const channel = '0195f5d1-4c4b-7a3e-9b3f-2d6a1c8e9f01';
    const draft = draftFromRoutine(
      routine({
        trigger: {
          type: 'events',
          filters: [{ events: ['channel.message_posted'], ids: [channel] }],
        },
      }),
      'claude'
    );
    if (typeof draft === 'string') throw new Error(draft);
    // Saving it watches that one channel, not every channel.
    expect(JSON.stringify(draftToCreateBody(draft))).toContain(channel);
  });

  it('keeps a single agent routine in the simple form', () => {
    const draft = draftFromRoutine(
      routine({
        trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
        steps: [
          { type: 'agent', model: 'claude', instructions: 'Summarize my day' },
        ],
      }),
      'claude'
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps).toBeUndefined();
    expect(draft.prompt).toBe('Summarize my day');
    expect(draft.triggers?.[0]).toMatchObject({
      kind: 'schedule',
      frequency: 'day',
    });
  });

  it('starts without a trigger when AI found none it could use', () => {
    const draft = draftFromRoutine(routine({ trigger: null }), 'claude');
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.triggers).toEqual([]);
  });

  it('keeps a code step that still fails, with its problems, and holds it back from saving', () => {
    const problems = ["TS2339 [ERROR]: Property 'guess' does not exist"];
    const draft = draftFromRoutine(
      routine({ problems: [{ index: 0, problems }] }),
      'claude'
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({ kind: 'code', problems });
    expect(validateSteps(draft.steps ?? [])).toContain(
      'doesn’t type-check yet'
    );
    // Problems are the editor's; they are never saved.
    expect(JSON.stringify(draftToCreateBody(draft))).not.toContain('TS2339');
  });

  it('explains steps the editor can’t use', () => {
    expect(
      draftFromRoutine(
        routine({ steps: [{ type: 'agent', instructions: 'Go' }] }),
        'claude'
      )
    ).toMatch(/can’t run/);
  });
});
