import { describe, expect, it } from 'vitest';
import {
  agentStep,
  chooseStep,
  firstAgent,
  ifStep,
  type StepDraft,
  stepsFromTask,
  stepsNeedEvent,
  stepsToWire,
  validateSteps,
  type WireStep,
} from './routine-steps';
import type { RoutineTriggerDraft } from './routine-triggers';

const model = { kind: 'model', model: 'm' } as const;
const email: RoutineTriggerDraft = {
  id: 'email',
  kind: 'event',
  events: ['email.message_received'],
};
const daily: RoutineTriggerDraft = {
  id: 'daily',
  kind: 'schedule',
  frequency: 'day',
  time: '09:00',
  daysOfWeek: [],
  dayOfMonth: '1',
  timezone: 'UTC',
  onceAt: '',
  cron: '0 0 9 * * *',
};
const valid = () => null;

const triage: WireStep[] = [
  {
    type: 'choose',
    question: 'What kind of email is this?',
    options: [
      {
        label: 'Invoice',
        description: 'bills',
        steps: [
          {
            type: 'tool',
            tool: 'UpdateThreadLabels',
            arguments: {
              thread_id: '{{trigger.entity_id}}',
              label: 'Finance',
              add: true,
            },
          },
          {
            type: 'tool',
            id: 'task',
            tool: 'CreateDocument',
            arguments: { documentName: 'Pay', isTask: true },
          },
        ],
      },
      { label: 'Newsletter', steps: [] },
    ],
    otherwise: [
      {
        type: 'if',
        condition: 'Is it urgent?',
        // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
        then: [{ type: 'agent', model: 'm', instructions: 'Escalate' }],
      },
    ],
  },
];

describe('routine steps', () => {
  it('round-trips a program and ignores single agent tasks', () => {
    const steps = stepsFromTask({ steps: triage });
    expect(steps).toBeDefined();
    expect(stepsToWire(steps ?? [])).toEqual([
      {
        ...triage[0],
        options: [
          triage[0]?.type === 'choose' ? triage[0].options[0] : undefined,
          { label: 'Newsletter', steps: [] },
        ],
        otherwise: [
          {
            type: 'if',
            condition: 'Is it urgent?',
            // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
            then: [{ type: 'agent', model: 'm', instructions: 'Escalate' }],
          },
        ],
      },
    ]);
    expect(
      stepsFromTask({ model: 'm', prompt: '', user_prompt: 'Summarize' })
    ).toBeUndefined();
    expect(
      stepsFromTask({ steps: [{ type: 'tool', tool: 'DeleteDocument' }] })
    ).toBeUndefined();
  });

  it('keeps agent selections and model overrides on the wire', () => {
    const agentId = '12345678-1234-1234-1234-123456789abc';
    const wire = stepsToWire([
      agentStep({ kind: 'agent', agentId, modelOverride: 'x' }, ' Go '),
      agentStep({ kind: 'agent', agentId }, 'Go'),
    ]);
    expect(wire).toEqual([
      {
        type: 'agent',
        agent: { bot_id: agentId },
        model: 'x',
        instructions: 'Go',
      },
      { type: 'agent', agent: { bot_id: agentId }, instructions: 'Go' },
    ]);
    expect(stepsFromTask({ steps: wire })?.map((step) => step.kind)).toEqual([
      'agent',
      'agent',
    ]);
  });

  it('finds the first reachable agent in program order', () => {
    const steps = stepsFromTask({ steps: triage }) ?? [];
    expect(firstAgent(steps)?.instructions).toBe('Escalate');
    expect(firstAgent([])).toBeUndefined();
  });

  it('needs activity triggers only when steps decide or read the trigger', () => {
    const decided: StepDraft[] = [{ ...ifStep('Urgent?') }];
    const reads: StepDraft[] = [
      {
        id: 'tool',
        kind: 'tool',
        tool: 'SendChannelMessage',
        arguments: { channel_id: 'c', content: '{{trigger.email.subject}}' },
      },
    ];
    expect(stepsNeedEvent(decided)).toBe(true);
    expect(stepsNeedEvent(reads)).toBe(true);
    expect(stepsNeedEvent([agentStep(model, 'Summarize')])).toBe(false);
    expect(validateSteps(decided, [email], valid)).toBeNull();
    expect(validateSteps(decided, [email, daily], valid)).toMatch(
      /activity triggers only/
    );
    expect(validateSteps([agentStep(model, 'Go')], [daily], valid)).toBeNull();
  });

  it('enforces one agent per run, filled-in decisions and distinct options', () => {
    expect(validateSteps([], [email], valid)).toMatch(/Add a step/);
    expect(
      validateSteps(
        [agentStep(model, 'One'), agentStep(model, 'Two')],
        [email],
        valid
      )
    ).toMatch(/one agent/);
    expect(
      validateSteps(
        [
          {
            ...ifStep('Urgent?'),
            yes: [agentStep(model, 'Yes')],
            no: [agentStep(model, 'No')],
          },
        ],
        [email],
        valid
      )
    ).toBeNull();
    expect(validateSteps([ifStep(' ')], [email], valid)).toMatch(/question/);
    const choice = chooseStep('Kind?');
    expect(validateSteps([choice], [email], valid)).toMatch(/label/);
    const same = {
      ...choice,
      options: choice.options.map((option) => ({ ...option, label: 'A' })),
    };
    expect(validateSteps([same], [email], valid)).toMatch(/different/);
    expect(validateSteps([agentStep(model, ' ')], [email], valid)).toMatch(
      /Tell the agent/
    );
    expect(
      validateSteps(
        [
          {
            id: 't',
            kind: 'tool',
            tool: 'CreateDocument',
            arguments: {},
          },
        ],
        [email],
        () => 'Give each new task a title.'
      )
    ).toBe('Give each new task a title.');
  });
});
