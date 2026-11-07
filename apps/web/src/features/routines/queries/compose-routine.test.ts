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
  decisions: true,
  codeSteps: true,
};

const BUG_REPORTS = 'every time a message gets sent in bug-reports make a task';

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
  created: [],
  ...overrides,
});

beforeEach(() => {
  draftRoutine.mockReset();
});

describe('composeRoutine', () => {
  it('sends only the description and settings, never the workspace', async () => {
    draftRoutine.mockResolvedValue(ok(routine()));

    const draft = await composeRoutine(BUG_REPORTS, context);

    // The drafter looks up bug-reports itself, so a workspace of any size
    // sends the same small body.
    expect(draftRoutine).toHaveBeenCalledWith({
      draft: { type: 'routine', description: BUG_REPORTS },
      context: {
        timezone: 'America/New_York',
        agentModel: 'claude',
        code: true,
        conditions: true,
      },
    });
    // A large workspace once made this request exceed the size limit.
    expect(draftRoutine.mock.calls[0][0].context).not.toHaveProperty(
      'workspace'
    );
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

  it('says when the request was too large, timed out or hit the usage limit', async () => {
    const generic = 'Couldn’t draft that routine. Please try again.';
    draftRoutine.mockResolvedValueOnce(
      err([{ code: 'PAYLOAD_TOO_LARGE', message: 'Request too large' }])
    );
    const tooLarge = await composeRoutine(BUG_REPORTS, context);
    draftRoutine.mockResolvedValueOnce(
      err([{ code: 'TIMEOUT', message: 'Request timed out' }])
    );
    const timedOut = await composeRoutine(BUG_REPORTS, context);
    draftRoutine.mockResolvedValueOnce(
      err([
        {
          code: 'AI_USAGE_LIMIT',
          reason: 'ai_free_allowance_exhausted',
          message: 'You’ve used this month’s free AI.',
        },
      ])
    );
    const limited = await composeRoutine(BUG_REPORTS, context);

    expect(tooLarge).toMatch(/too large/);
    expect(timedOut).toMatch(/took too long/);
    expect(new Set([tooLarge, timedOut, generic]).size).toBe(3);
    expect(limited).toBe('You’ve used this month’s free AI.');
  });
});

describe('a drafted routine in the editor', () => {
  it('lists what AI created for it, which exists even if it isn’t saved', () => {
    const created = [
      { entityType: 'database' as const, entityId: 'bug-log-database' },
    ];
    const draft = draftFromRoutine(routine({ created }), 'claude');
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.created).toEqual(created);
  });

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
