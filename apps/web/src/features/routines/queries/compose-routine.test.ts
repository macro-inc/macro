import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSteps } from '../core/routine-steps';
import {
  type CodeFailure,
  codeFixPrompt,
  composeRoutine,
  compositionInstructions,
  compositionOutputSchema,
  draftFromComposition,
} from './compose-routine';
import { draftToCreateBody } from './routine-draft';

const clients = vi.hoisted(() => ({
  structuredCompletion: vi.fn(),
  codeGuide: vi.fn(),
  checkCode: vi.fn(),
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    structuredCompletion: clients.structuredCompletion,
  },
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    codeGuide: clients.codeGuide,
    checkCode: clients.checkCode,
  },
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

const context = { defaultModel: 'claude', decisions: true };

const labelStep = {
  type: 'code',
  title: 'Label by topic',
  summary: 'Asks AI which label fits and adds it.',
  writes: ['email'],
  source: 'export async function main() {}',
};

describe('routine composition', () => {
  it('turns triage into an event routine with code', () => {
    const draft = draftFromComposition(
      {
        name: 'Inbox triage',
        triggers: [
          {
            type: 'event',
            events: ['email.message_received'],
            condition: null,
          },
        ],
        steps: [labelStep],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.name).toBe('Inbox triage');
    expect(draft.triggers).toMatchObject([
      { kind: 'event', events: ['email.message_received'] },
    ]);
    // Named as saving will name it.
    expect(draft.steps?.[0]).toMatchObject({
      kind: 'code',
      output: 'label_by_topic',
    });
  });

  it('keeps the knobs and sentence a drafted code step declares', () => {
    const knob = {
      type: 'text',
      name: 'label',
      label: 'Label to add',
      value: 'vc',
    };
    const draft = draftFromComposition(
      {
        name: 'Inbox triage',
        triggers: [{ type: 'event', events: ['email.message_received'] }],
        steps: [{ ...labelStep, knobs: [knob], sentence: 'Label it {label}.' }],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({
      kind: 'code',
      knobs: [knob],
      sentence: 'Label it {label}.',
    });
  });

  it('keeps a trigger limited to the items it names', () => {
    const channel = '0195f5d1-4c4b-7a3e-9b3f-2d6a1c8e9f01';
    const draft = draftFromComposition(
      {
        name: 'Copy launches',
        triggers: [
          {
            type: 'event',
            events: ['channel.message_posted'],
            ids: [channel],
          },
        ],
        steps: [labelStep],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    // Saving it watches that one channel, not every channel.
    expect(JSON.stringify(draftToCreateBody(draft))).toContain(channel);
  });

  it('keeps a single agent routine in the simple form', () => {
    const draft = draftFromComposition(
      {
        name: 'Daily brief',
        triggers: [
          { type: 'cron', expression: '0 0 9 * * *', timezone: 'UTC' },
        ],
        steps: [
          { type: 'agent', model: 'claude', instructions: 'Summarize my day' },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps).toBeUndefined();
    expect(draft.prompt).toBe('Summarize my day');
    expect(draft.triggers?.[0]).toMatchObject({
      kind: 'schedule',
      frequency: 'day',
    });
  });

  it('explains drafts it cannot use', () => {
    expect(draftFromComposition({ name: 'x' }, context)).toMatch(/incomplete/);
    expect(
      draftFromComposition(
        {
          name: 'x',
          triggers: [],
          steps: [{ type: 'wait', seconds: 5 }],
        },
        context
      )
    ).toMatch(/can’t run/);
  });

  it('tells the model which names and ids it may use', () => {
    const instructions = compositionInstructions({
      now: new Date('2026-10-09T12:00:00Z'),
      timezone: 'America/New_York',
      defaultModel: 'claude',
      userId: 'macro|me@example.com',
      labels: ['Finance'],
      tags: [{ label: 'Urgent', definitionId: 'd', optionId: 'o' }],
      channels: [{ name: 'billing', id: 'c' }],
      folders: [{ name: 'Receipts', id: 'f' }],
      people: [{ name: 'Ada', id: 'macro|ada@example.com' }],
      agents: [],
      decisions: false,
    });
    expect(instructions).toContain('"Finance"');
    expect(instructions).toContain('"billing"');
    expect(instructions).toContain('"Receipts"');
    expect(instructions).toContain('macro|ada@example.com');
    expect(instructions).toContain('Trigger conditions are unavailable');
    expect(instructions).toContain('2026-10-09T12:00:00.000Z');
  });

  it('refuses a draft whose trigger needs AI decisions when they are off', () => {
    const withCondition = {
      name: 'Invoices',
      triggers: [
        {
          type: 'event',
          events: ['email.message_received'],
          condition: 'Is it an invoice?',
        },
      ],
      steps: [{ type: 'agent', instructions: 'File it', model: 'claude' }],
    };
    expect(
      draftFromComposition(withCondition, { ...context, decisions: false })
    ).toMatch(/needs AI to decide/);
    expect(typeof draftFromComposition(withCondition, context)).not.toBe(
      'string'
    );
  });
});

const guidance = {
  steps: 'Code steps: a `code` step runs TypeScript against Macro’s SDK.',
  contract: 'interface StepContext { macro: Macro }',
  reference: 'NotificationNamespace: list(), markDone()',
  examples: [
    {
      request: 'When a new email arrives, label it by topic.',
      steps: [labelStep],
    },
  ],
};

function notifications(source: string) {
  return {
    name: 'Important notifications',
    triggers: [{ type: 'cron', expression: '0 0 9 * * *', timezone: 'UTC' }],
    steps: [
      {
        type: 'code',
        id: 'important',
        title: 'Surface important notifications',
        summary: 'Goes through notifications and keeps the important ones.',
        writes: ['workspace'],
        source,
      },
    ],
  };
}

const composerContext = {
  now: new Date('2026-11-01T09:00:00Z'),
  timezone: 'UTC',
  defaultModel: 'claude',
  userId: 'macro|owner@example.com',
  labels: [],
  tags: [],
  channels: [],
  folders: [],
  people: [],
  agents: [],
  decisions: true,
};

const failing: CodeFailure = {
  index: 0,
  title: 'Surface important notifications',
  source: 'macro.notifications.guess()',
  problems: [
    "TS2339 [ERROR]: Property 'guess' does not exist on type 'NotificationNamespace'.",
  ],
  declarations:
    'export declare class NotificationNamespace { list(): Promise<Notification[]> }',
};

describe('drafting code steps', () => {
  it('describes code steps only when the scheduler can check them', () => {
    const withCode = compositionInstructions(composerContext, guidance);
    expect(withCode).toContain('{"type":"code"');
    expect(withCode).toContain(guidance.steps);
    expect(withCode).toContain(guidance.contract);
    expect(withCode).toContain(guidance.reference);
    // The starters are its worked examples.
    expect(withCode).toContain(guidance.examples[0]?.request);
    expect(withCode).toContain('"title":"Label by topic"');
    expect(compositionInstructions(composerContext)).not.toContain(
      '"type":"code"'
    );
    const types = (code: boolean) =>
      compositionOutputSchema(code).schema.properties.steps.items.properties
        .type.enum;
    expect(types(true)).toContain('code');
    expect(types(false)).not.toContain('code');
  });

  it('keeps a code step that still fails, with its problems, and holds it back from saving', () => {
    const draft = draftFromComposition(notifications(failing.source), context, [
      failing,
    ]);
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({
      kind: 'code',
      problems: failing.problems,
    });
    expect(validateSteps(draft.steps ?? [])).toContain(
      'doesn’t type-check yet'
    );
    // Problems are the editor's; they are never saved.
    expect(JSON.stringify(draftToCreateBody(draft))).not.toContain('TS2339');
  });

  it('asks for the routine again with each failing step’s problems and declarations', () => {
    const prompt = codeFixPrompt(
      'surface my important notifications',
      notifications(failing.source),
      [failing]
    );
    expect(prompt).toContain('surface my important notifications');
    expect(prompt).toContain('"source":"macro.notifications.guess()"');
    expect(prompt).toContain(failing.problems[0]);
    expect(prompt).toContain(failing.declarations);
  });
});

describe('composeRoutine', () => {
  const completed = (result: unknown) =>
    ok({ outcome: { status: 'completed', result } });
  const checks = (problems: string[]) =>
    ok({
      sdk: '0.3.0+x',
      steps: problems.length
        ? [
            {
              index: 0,
              title: 'Surface important notifications',
              problems,
              declarations: 'decls',
            },
          ]
        : [],
    });

  beforeEach(() => {
    clients.structuredCompletion.mockReset();
    clients.codeGuide
      .mockReset()
      .mockResolvedValue(ok({ sdk: '0.3.0+x', ...guidance }));
    clients.checkCode.mockReset();
  });

  it('fixes code the type checker rejects, then drafts it', async () => {
    clients.structuredCompletion
      .mockResolvedValueOnce(completed(notifications('bad')))
      .mockResolvedValueOnce(completed(notifications('good')));
    clients.checkCode
      .mockResolvedValueOnce(checks(['TS2339 [ERROR]: no guess']))
      .mockResolvedValueOnce(checks([]));
    const draft = await composeRoutine(
      'surface my important notifications',
      composerContext,
      'claude' as never
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({ kind: 'code', source: 'good' });
    expect(draft.steps?.[0]).not.toHaveProperty('problems');
    expect(clients.codeGuide).toHaveBeenCalledWith({
      task: 'surface my important notifications',
    });
    const [first, second] = clients.structuredCompletion.mock.calls.map(
      ([request]) => request
    );
    expect(first.additional_instructions).toContain(guidance.reference);
    expect(second.prompt).toContain('TS2339 [ERROR]: no guess');
    expect(second.prompt).toContain('decls');
    // The routine's steps are checked together, as the model wrote them.
    expect(clients.checkCode).toHaveBeenCalledWith({
      steps: notifications('bad').steps,
    });
  });

  it('shows each problem on the code step the check names', async () => {
    const twoSteps = {
      ...notifications('first'),
      steps: [
        ...notifications('first').steps,
        {
          type: 'code',
          title: 'Report',
          summary: 'Reports the count.',
          writes: [],
          source: 'second',
        },
      ],
    };
    clients.structuredCompletion.mockResolvedValue(completed(twoSteps));
    clients.checkCode.mockResolvedValue(
      ok({
        sdk: '0.3.0+x',
        steps: [
          {
            index: 1,
            title: 'Report',
            problems: ["Property 'total' does not exist"],
            declarations: '',
          },
        ],
      })
    );
    const draft = await composeRoutine(
      'count and report',
      composerContext,
      'claude' as never
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).not.toHaveProperty('problems');
    expect(draft.steps?.[1]).toMatchObject({
      kind: 'code',
      source: 'second',
      problems: ["Property 'total' does not exist"],
    });
  });

  it('stops after a bounded number of fixes and shows what still fails', async () => {
    clients.structuredCompletion.mockResolvedValue(
      completed(notifications('bad'))
    );
    clients.checkCode.mockResolvedValue(checks(['TS2339 [ERROR]: no guess']));
    const draft = await composeRoutine(
      'surface my important notifications',
      composerContext,
      'claude' as never
    );
    if (typeof draft === 'string') throw new Error(draft);
    // The draft, then three fixes, each asking the model to think briefly.
    expect(clients.structuredCompletion).toHaveBeenCalledTimes(4);
    for (const [request] of clients.structuredCompletion.mock.calls)
      expect(request).toMatchObject({ thinking: 'low' });
    expect(draft.steps?.[0]).toMatchObject({
      kind: 'code',
      problems: ['TS2339 [ERROR]: no guess'],
    });
  });

  it('drafts without code steps when the scheduler can’t check code', async () => {
    clients.codeGuide.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: '503' }])
    );
    clients.structuredCompletion.mockResolvedValue(
      completed({
        name: 'Summary',
        triggers: [],
        steps: [{ type: 'agent', model: 'claude', instructions: 'Summarize' }],
      })
    );
    const draft = await composeRoutine(
      'summarize',
      composerContext,
      'claude' as never
    );
    if (typeof draft === 'string') throw new Error(draft);
    const [request] = clients.structuredCompletion.mock.calls[0] ?? [];
    expect(
      request.output_schema.schema.properties.steps.items.properties.type.enum
    ).not.toContain('code');
    expect(clients.checkCode).not.toHaveBeenCalled();
  });
});
