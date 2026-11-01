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

describe('routine composition', () => {
  it('turns triage into an event routine with steps', () => {
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
        steps: [
          {
            type: 'choose',
            question: 'What kind of email is this?',
            options: [
              {
                label: 'Newsletter',
                steps: [
                  {
                    type: 'tool',
                    tool: 'UpdateThreadLabels',
                    arguments: {
                      thread_id: '{{trigger.entity_id}}',
                      label: 'INBOX',
                      add: false,
                    },
                  },
                ],
              },
              { label: 'Invoice', steps: [] },
            ],
          },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.name).toBe('Inbox triage');
    expect(draft.triggers).toMatchObject([
      { kind: 'event', events: ['email.message_received'] },
    ]);
    expect(draft.steps?.[0]?.kind).toBe('choose');
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
        steps: [
          {
            type: 'tool',
            tool: 'CreateDocument',
            arguments: {
              documentName: 'Launch note',
              fileContent: '',
              fileExtension: 'md',
            },
          },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    // Saving it watches that one channel, not every channel.
    expect(JSON.stringify(draftToCreateBody(draft))).toContain(channel);
  });

  it('keeps choices that apply every fitting option', () => {
    const label = (name: string) => ({
      label: name,
      steps: [
        {
          type: 'tool',
          tool: 'UpdateThreadLabels',
          arguments: {
            thread_id: '{{trigger.entity_id}}',
            label: name,
            add: true,
          },
        },
      ],
    });
    const draft = draftFromComposition(
      {
        name: 'Label by topic',
        triggers: [{ type: 'event', events: ['email.message_received'] }],
        steps: [
          {
            type: 'choose',
            multiple: true,
            options: [label('Finance'), label('Hiring')],
          },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({ kind: 'choose', multiple: true });
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
          steps: [{ type: 'tool', tool: 'DeleteEverything', arguments: {} }],
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
    expect(instructions).toContain('Decisions are unavailable');
    expect(instructions).toContain('2026-10-09T12:00:00.000Z');
  });

  it('refuses a draft that needs AI decisions when they are off', () => {
    const withDecision = {
      name: 'Inbox triage',
      triggers: [{ type: 'event', events: ['email.message_received'] }],
      steps: [
        {
          type: 'if',
          condition: 'Is it a newsletter?',
          // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
          then: [],
          else: [],
        },
      ],
    };
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
    for (const output of [withDecision, withCondition]) {
      expect(
        draftFromComposition(output, { ...context, decisions: false })
      ).toMatch(/needs AI to decide/);
      expect(typeof draftFromComposition(output, context)).not.toBe('string');
    }
  });
});

const guidance = {
  steps: 'Code steps: a `code` step runs TypeScript against Macro’s SDK.',
  contract: 'interface StepContext { macro: Macro }',
  reference: 'NotificationNamespace: list(), markDone()',
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
    expect(
      validateSteps(draft.steps ?? [], draft.triggers ?? [], () => null)
    ).toContain('doesn’t type-check yet');
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
      problems,
      declarations: problems.length ? 'decls' : '',
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
    expect(clients.structuredCompletion).toHaveBeenCalledTimes(3);
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
