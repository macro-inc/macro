import { describe, expect, it } from 'vitest';
import {
  agentStep,
  assignedOutputs,
  firstAgent,
  type StepDraft,
  stepsFromTask,
  stepsToWire,
  validateSteps,
  type WireStep,
  withAssignedOutputs,
  withNamedOutputs,
} from './routine-steps';

const model = { kind: 'model', model: 'm' } as const;

const code: WireStep = {
  type: 'code',
  id: 'invoice',
  title: 'Label invoices',
  summary: 'Asks whether the email is an invoice and labels it.',
  source: 'export async function main({ macro }: StepContext) {}',
};

const unnamed = (title: string): WireStep => ({
  type: 'code',
  title,
  source: 'export async function main() {}',
});

describe('routine steps', () => {
  it('round-trips code and Ask AI steps and ignores single agent tasks', () => {
    const wire: WireStep[] = [
      code,
      { type: 'agent', model: 'm', instructions: 'Escalate' },
    ];
    const steps = stepsFromTask({ steps: wire, sdk: '0.2.2+abc' });
    expect(steps?.[0]).toMatchObject({
      kind: 'code',
      output: 'invoice',
      title: 'Label invoices',
    });
    expect(stepsToWire(steps ?? [])).toEqual(wire);
    expect(firstAgent(steps ?? [])?.instructions).toBe('Escalate');
    expect(
      stepsFromTask({ model: 'm', prompt: '', user_prompt: 'Summarize' })
    ).toBeUndefined();
  });

  it('reads no program with a step type it doesn’t know', () => {
    for (const step of [
      { type: 'tool', tool: 'CreateDocument', arguments: {} },
      { type: 'if', condition: 'Urgent?' },
      { type: 'choose', options: [] },
    ])
      expect(stepsFromTask({ steps: [step] })).toBeUndefined();
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
  });

  it('keeps one Ask AI step and its instructions within the scheduler’s limits', () => {
    expect(validateSteps([])).toMatch(/Add a step/);
    expect(validateSteps([agentStep(model, 'x'.repeat(20_001))])).toMatch(
      /under 20,000 characters/
    );
    expect(validateSteps([agentStep(model, 'x'.repeat(20_000))])).toBeNull();
    expect(
      validateSteps([agentStep(model, 'One'), agentStep(model, 'Two')])
    ).toMatch(/one Ask AI step/);
  });
});

describe('code steps', () => {
  it('need a title and code', () => {
    const [step] = stepsFromTask({ steps: [code] }) ?? [];
    if (step?.kind !== 'code') throw new Error('expected a code step');
    expect(validateSteps([step])).toBeNull();
    expect(validateSteps([{ ...step, title: ' ' }])).toContain('title');
    expect(validateSteps([{ ...step, source: '' }])).toContain('code');
  });

  it('name outputs uniquely', () => {
    const [step] = stepsFromTask({ steps: [code] }) ?? [];
    if (!step) throw new Error('expected a code step');
    expect(validateSteps([step, { ...step, id: 'copy' }])).toBe(
      'Two steps name their output the same. Remove one and add it again.'
    );
  });
});

describe('step output names', () => {
  const outputs = (steps: StepDraft[]) =>
    steps.map((step) => (step.kind === 'code' ? step.output : undefined));

  // The same names as the scheduler's own test.
  const routine = () =>
    stepsFromTask({
      steps: [
        unnamed('Filter Important Notifications!'),
        unnamed('filter important notifications'),
        unnamed('Create Document'),
        { ...unnamed('2nd pass'), id: 'kept' },
        unnamed('sendChannelMessage'),
      ],
    }) ?? [];

  it('names outputs the way saving does, keeping names already given', () => {
    const named = withNamedOutputs(routine());
    expect(outputs(named)).toEqual([
      'filter_important',
      'filter_important_2',
      'create_document',
      'kept',
      'send_channel_message',
    ]);
    expect(withNamedOutputs(named)).toEqual(named);
    expect(
      outputs(
        withNamedOutputs(stepsFromTask({ steps: [unnamed('42 ways')] }) ?? [])
      )
    ).toEqual(['step_42_ways']);
  });

  it('keeps the names saving gave, so a later step can’t take them', () => {
    const sent = routine();
    const saved = withNamedOutputs(
      stepsFromTask({ steps: stepsToWire(sent) }) ?? []
    );
    const assigned = assignedOutputs(sent, saved);
    expect(outputs(withAssignedOutputs(sent, assigned))).toEqual(
      outputs(saved)
    );
    // A different shape matches nothing.
    expect(assignedOutputs(sent, saved.slice(1)).size).toBe(0);
  });
});
