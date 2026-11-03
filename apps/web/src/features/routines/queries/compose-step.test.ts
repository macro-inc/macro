import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentStep,
  type CodeStepDraft,
  type StepDraft,
} from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { composeStep, reviseStep, shortReason } from './compose-step';

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

const context = {
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

const guidance = {
  steps: 'Code steps run TypeScript.',
  contract: 'export async function main(ctx)',
  reference: 'declare namespace macro {}',
  examples: [],
};

const daily: RoutineTriggerDraft = {
  id: 'daily',
  kind: 'event',
  events: ['task.created'],
};

const escalate: CodeStepDraft = {
  id: 'escalate',
  kind: 'code',
  output: 'escalate',
  title: 'Escalate blocking tasks',
  summary: 'Sets blocking tasks to urgent.',
  source: 'export async function main() { /* v1 */ }',
  writes: ['workspace'],
  knobs: [
    { type: 'number', name: 'days', label: 'Days ahead', value: 3, min: 1 },
  ],
  sentence: 'Check tasks due within {days} days.',
};

const wire = (source: string) => ({
  type: 'code',
  title: 'Post a summary',
  summary: 'Posts what changed.',
  writes: ['workspace'],
  source,
});

const completed = (result: unknown) =>
  ok({ outcome: { status: 'completed', result } });

const checks = (index: number, problems: string[]) =>
  ok({
    sdk: '0.3.0+x',
    steps: problems.length
      ? [{ index, title: 'Step', problems, declarations: 'decls' }]
      : [],
  });

beforeEach(() => {
  clients.structuredCompletion.mockReset();
  clients.codeGuide
    .mockReset()
    .mockResolvedValue(ok({ sdk: '0.3.0+x', ...guidance }));
  clients.checkCode.mockReset();
});

describe('adding one step with AI', () => {
  it('drafts the next step, checks it after the steps before it, and fixes it', async () => {
    clients.structuredCompletion
      .mockResolvedValueOnce(
        completed({ step: wire('bad'), reason: 'same every run' })
      )
      .mockResolvedValueOnce(completed({ step: wire('good') }));
    clients.checkCode
      .mockResolvedValueOnce(checks(1, ['TS2339: no post']))
      .mockResolvedValueOnce(checks(1, []));
    const added = await composeStep({
      description: 'post a summary in updates',
      routine: { triggers: [daily], steps: [escalate] },
      context,
      model: 'claude' as never,
    });
    if (typeof added === 'string') throw new Error(added);
    expect(added.reason).toBe('same every run');
    expect(added.step).toMatchObject({
      kind: 'code',
      source: 'good',
      output: 'post_a_summary',
    });
    expect(added.step).not.toHaveProperty('problems');
    const [first, second] = clients.structuredCompletion.mock.calls.map(
      ([request]) => request
    );
    // It sees the routine so far, as data, and returns why it chose its kind.
    expect(first.additional_instructions).toContain(
      '"title":"Escalate blocking tasks"'
    );
    expect(first.output_schema.schema.required).toEqual(['step', 'reason']);
    expect(second.prompt).toContain('TS2339: no post');
    const [check] = clients.checkCode.mock.calls[0] ?? [];
    expect(check.steps.map((step: { title: string }) => step.title)).toEqual([
      'Escalate blocking tasks',
      'Post a summary',
    ]);
  });

  it('writes Ask AI when asked, but only once per routine', async () => {
    clients.structuredCompletion.mockResolvedValue(
      completed({
        step: { type: 'agent', model: 'claude', instructions: 'Summarize' },
        reason: 'needs judgment',
      })
    );
    const routine = { triggers: [daily], steps: [escalate] as StepDraft[] };
    const added = await composeStep({
      description: 'summarize it',
      routine,
      context,
      model: 'claude' as never,
      kind: 'agent',
    });
    if (typeof added === 'string') throw new Error(added);
    expect(added.step.kind).toBe('agent');
    expect(clients.codeGuide).not.toHaveBeenCalled();
    expect(clients.checkCode).not.toHaveBeenCalled();

    const refused = await composeStep({
      description: 'summarize it again',
      routine: {
        ...routine,
        steps: [...routine.steps, agentStep({ kind: 'model', model: 'm' })],
      },
      context,
      model: 'claude' as never,
      kind: 'agent',
    });
    expect(refused).toMatch(/already has its Ask AI step/);
  });
});

describe('changing a step in words', () => {
  it('keeps the step’s id and output, and checks it in its place', async () => {
    clients.structuredCompletion.mockResolvedValue(
      completed({
        step: {
          type: 'code',
          id: 'other',
          output: 'renamed',
          title: escalate.title,
          summary: escalate.summary,
          writes: ['workspace'],
          source: 'export async function main() { /* v2 */ }',
          knobs: escalate.knobs,
          sentence: 'Check tasks due within {days} days and overdue tasks.',
        },
      })
    );
    clients.checkCode.mockResolvedValue(checks(0, []));
    const later = agentStep({ kind: 'model', model: 'm' }, 'Summarize');
    const revised = await reviseStep({
      step: escalate,
      instruction: 'also include overdue tasks',
      routine: { triggers: [daily], steps: [escalate, later] },
      context,
      model: 'claude' as never,
    });
    if (typeof revised === 'string') throw new Error(revised);
    expect(revised).toMatchObject({
      id: 'escalate',
      output: 'escalate',
      source: 'export async function main() { /* v2 */ }',
      knobs: escalate.knobs,
    });
    const [request] = clients.structuredCompletion.mock.calls[0] ?? [];
    expect(request.prompt).toBe('also include overdue tasks');
    expect(request.additional_instructions).toContain('/* v1 */');
    const [check] = clients.checkCode.mock.calls[0] ?? [];
    expect(check.steps).toHaveLength(2);
    expect(check.steps[0].source).toContain('/* v2 */');
  });
});

describe('a step’s reason', () => {
  it('keeps one short phrase, and drops the model thinking aloud', () => {
    expect(shortReason(' Writing the summary takes judgment each run. ')).toBe(
      'Writing the summary takes judgment each run'
    );
    expect(
      shortReason(
        'Code can check what tasks were updated or post deterministic notes, but writing a human summary of what changed fits Ask AI better here. Wait.'
      )
    ).toBe('');
  });
});
