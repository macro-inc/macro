import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentStep, type CodeStepDraft } from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { composeStep, reviseStep } from './compose-step';

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
  timezone: 'UTC',
  defaultModel: 'claude',
  labels: [],
  tags: [],
  channels: [],
  folders: [],
  people: [],
  agents: [],
  decisions: true,
  codeSteps: true,
};

const created: RoutineTriggerDraft = {
  id: 'created',
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
  knobs: [
    { type: 'number', name: 'days', label: 'Days ahead', value: 3, min: 1 },
  ],
  sentence: 'Check tasks due within {days} days.',
};

const wire = (source: string) => ({
  type: 'code',
  id: 'post_a_summary',
  title: 'Post a summary',
  summary: 'Posts what changed.',
  source,
});

beforeEach(() => {
  draftRoutine.mockReset();
});

describe('adding one step with AI', () => {
  it('sends the routine so far and returns the step with its reason and problems', async () => {
    draftRoutine.mockResolvedValue(
      ok({
        outcome: 'step',
        step: wire('bad'),
        reason: 'one message to send',
        problems: ['TS2339 [ERROR]: nope'],
      })
    );

    const added = await composeStep({
      description: 'post a summary',
      routine: { triggers: [created], steps: [escalate] },
      context,
      kind: 'code',
    });

    expect(draftRoutine.mock.calls[0][0].draft).toEqual({
      type: 'add_step',
      description: 'post a summary',
      kind: 'code',
      routine: {
        trigger: {
          type: 'events',
          filters: [{ events: ['task.created'] }],
        },
        steps: [
          {
            type: 'code',
            id: 'escalate',
            title: 'Escalate blocking tasks',
            summary: 'Sets blocking tasks to urgent.',
            source: 'export async function main() { /* v1 */ }',
            knobs: escalate.knobs,
            sentence: 'Check tasks due within {days} days.',
          },
        ],
      },
    });
    if (typeof added === 'string') throw new Error(added);
    expect(added.reason).toBe('one message to send');
    expect(added.step).toMatchObject({
      kind: 'code',
      output: 'post_a_summary',
      problems: ['TS2339 [ERROR]: nope'],
    });
  });

  it('says why AI couldn’t write it', async () => {
    draftRoutine.mockResolvedValue(
      ok({ outcome: 'failed', message: 'Change that one instead.' })
    );
    expect(
      await composeStep({
        description: 'research',
        routine: {
          triggers: [],
          steps: [agentStep({ kind: 'model', model: 'claude' })],
        },
        context,
      })
    ).toBe('Change that one instead.');
  });
});

describe('changing a step in words', () => {
  it('changes it in place and keeps its editor id', async () => {
    draftRoutine.mockResolvedValue(
      ok({
        outcome: 'step',
        step: { ...wire('v2'), id: 'escalate', title: 'Escalate' },
        reason: '',
        problems: [],
      })
    );

    const revised = await reviseStep({
      step: escalate,
      instruction: 'shorter',
      routine: { triggers: [], steps: [escalate] },
      context,
    });

    expect(draftRoutine.mock.calls[0][0].draft).toMatchObject({
      type: 'change_step',
      instruction: 'shorter',
      index: 0,
    });
    if (typeof revised === 'string') throw new Error(revised);
    expect(revised).toMatchObject({
      id: 'escalate',
      output: 'escalate',
      source: 'v2',
    });
    expect(revised.problems).toBeUndefined();
  });
});
