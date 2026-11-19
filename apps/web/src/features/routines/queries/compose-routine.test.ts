import type {
  DraftedRoutine,
  RoutineStep,
} from '@service-scheduled-action/generated/schemas';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.useRealTimers();
});

const DROPPED = { code: 'NETWORK_ERROR', message: 'Network error occurred' };
/** How the desktop app's native transport reports a dropped connection. */
const DROPPED_NATIVE = {
  code: 'UNKNOWN_ERROR',
  message: 'An unknown error occurred: error sending request for url',
};

/** Compose with the pause before a second attempt skipped. */
async function composeWithoutWaiting(description: string) {
  vi.useFakeTimers();
  const composed = composeRoutine(description, context);
  await vi.runAllTimersAsync();
  return await composed;
}

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

  it('sends the draft again when its connection drops, and opens that draft', async () => {
    // The connection drops mid-draft, before the server answers.
    draftRoutine
      .mockResolvedValueOnce(err([DROPPED]))
      .mockResolvedValueOnce(ok(routine()));

    const draft = await composeWithoutWaiting(BUG_REPORTS);

    expect(draftRoutine).toHaveBeenCalledTimes(2);
    expect(draftRoutine.mock.calls[1]).toEqual(draftRoutine.mock.calls[0]);
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.name).toBe('Inbox triage');
  });

  it('says the connection was lost when the second attempt gets no answer either', async () => {
    draftRoutine
      .mockResolvedValueOnce(err([DROPPED_NATIVE]))
      .mockResolvedValueOnce(err([DROPPED]));

    expect(await composeWithoutWaiting(BUG_REPORTS)).toBe(
      'Lost the connection while drafting. Check your connection and try again.'
    );
    expect(draftRoutine).toHaveBeenCalledTimes(2);
  });

  it('doesn’t send a draft again once nobody waits for it', async () => {
    draftRoutine.mockResolvedValueOnce(err([DROPPED]));
    vi.useFakeTimers();
    const left = new AbortController();

    const composed = composeRoutine(BUG_REPORTS, context, left.signal);
    // The user leaves the dialog, then the connection drops.
    left.abort();
    await vi.runAllTimersAsync();
    await composed;

    expect(draftRoutine).toHaveBeenCalledTimes(1);
  });

  it('sends a draft the server answered only once', async () => {
    draftRoutine.mockResolvedValueOnce(
      err([{ code: 'TIMEOUT', message: 'Request timed out' }])
    );

    expect(await composeWithoutWaiting(BUG_REPORTS)).toMatch(/took too long/);
    expect(draftRoutine).toHaveBeenCalledTimes(1);
  });
});

describe('a drafted routine in the editor', () => {
  it('lists what AI created for it, which exists even if it isn’t saved', () => {
    const created = [
      {
        entityType: 'database' as const,
        entityId: 'bug-log-database',
        used: true,
      },
      { entityType: 'document' as const, entityId: 'todays-task', used: false },
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

describe('a drafted routine with sub-routines', () => {
  const schedules = {
    type: 'code' as const,
    id: 'due_soon',
    title: 'Find tasks due soon',
    source: 'export async function main() {}',
  };
  const remindCode = {
    type: 'code' as const,
    title: 'Post the reminder',
    source: 'export async function main() {}',
  };
  const remind = {
    name: 'remind',
    title: 'Remind me',
    inputs: [{ type: 'text' as const, name: 'taskId', label: 'Task' }],
    steps: [remindCode],
  };

  it('keeps each sub-routine, and saves them with the routine', () => {
    const draft = draftFromRoutine(
      routine({ steps: [schedules], subRoutines: [remind] }),
      'claude'
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.subRoutines).toMatchObject([
      { name: 'remind', title: 'Remind me', inputs: remind.inputs },
    ]);
    expect(draftToCreateBody(draft).task).toMatchObject({
      steps: [schedules],
      sub_routines: [remind],
    });
  });

  it('puts each problem on its own step, not the routine step at that place', () => {
    const own = ["TS2339 [ERROR]: Property 'guess' does not exist"];
    const inner = ['TS2345 [ERROR]: Argument of type number'];
    const draft = draftFromRoutine(
      routine({
        steps: [schedules],
        subRoutines: [remind],
        problems: [
          { index: 0, problems: inner, subRoutine: 'remind' },
          { index: 0, problems: own },
        ],
      }),
      'claude'
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({ problems: own });
    expect(draft.subRoutines?.[0]?.steps[0]).toMatchObject({
      problems: inner,
    });
  });

  it('keeps a lone Ask AI step as steps, since only a program holds sub-routines', () => {
    const draft = draftFromRoutine(
      routine({
        steps: [{ type: 'agent', model: 'claude', instructions: 'Look' }],
        subRoutines: [remind],
      }),
      'claude'
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps).toHaveLength(1);
    expect(draft.subRoutines).toHaveLength(1);
  });
});
