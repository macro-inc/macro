import { describe, expect, it } from 'vitest';
import { stepsFromTask } from './routine-steps';
import {
  describeHistoryStep,
  latestStepRun,
  stepAtPath,
  stepsForRun,
} from './step-history';

const steps =
  stepsFromTask({
    steps: [
      {
        type: 'tool',
        tool: 'UpdateThreadLabels',
        arguments: { label: 'INBOX', add: false },
      },
      {
        type: 'choose',
        options: [
          {
            label: 'Invoice',
            steps: [
              {
                type: 'tool',
                tool: 'CreateDocument',
                arguments: { isTask: true },
              },
            ],
          },
          { label: 'Other', steps: [] },
        ],
        otherwise: [
          {
            type: 'if',
            condition: 'Is it urgent?',
            // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
            then: [{ type: 'agent', model: 'm', instructions: 'Go' }],
          },
        ],
      },
    ],
  }) ?? [];

describe('routine step history', () => {
  it('finds steps by their recorded path', () => {
    expect(stepAtPath(steps, '0')?.kind).toBe('tool');
    expect(stepAtPath(steps, '1.options.0.0')?.kind).toBe('tool');
    expect(stepAtPath(steps, '1.otherwise.0')?.kind).toBe('if');
    expect(stepAtPath(steps, '1.otherwise.0.then.0')?.kind).toBe('agent');
    expect(stepAtPath(steps, '1.options.3.0')).toBeUndefined();
    expect(stepAtPath(steps, '7')).toBeUndefined();
    expect(stepAtPath(undefined, '0')).toBeUndefined();
  });

  it('describes what a run did with the current step labels', () => {
    expect(
      describeHistoryStep(
        { path: '0', kind: 'tool', tool: 'UpdateThreadLabels' },
        steps
      )
    ).toBe('Archive');
    expect(
      describeHistoryStep(
        {
          path: '1.options.0.0',
          kind: 'tool',
          tool: 'CreateDocument',
          error: 'No access',
        },
        steps
      )
    ).toBe('Create task failed: No access');
    expect(
      describeHistoryStep(
        { path: '1', kind: 'choose', choices: ['Invoice'], probability: 0.9 },
        steps
      )
    ).toBe('Chose “Invoice”');
    expect(
      describeHistoryStep(
        { path: '1.otherwise.0', kind: 'if', answer: true, probability: 0.8 },
        steps
      )
    ).toBe('Is it urgent? yes');
    // A step that moved since the run still reads sensibly.
    expect(
      describeHistoryStep(
        { path: '9', kind: 'tool', tool: 'SendChannelMessage' },
        steps
      )
    ).toBe('Sent a message');
  });

  it('reads a run against the steps of the configuration it ran', () => {
    const routine = { revision: 3, draft: { steps } };
    const run = { revision: 3, steps: [] };
    expect(stepsForRun(run, routine)).toBe(steps);
    // After an edit, the same path can hold another step; describe the run
    // from what it recorded instead.
    const older = { ...run, revision: 2 };
    expect(stepsForRun(older, routine)).toBeUndefined();
    expect(
      describeHistoryStep(
        { path: '0', kind: 'tool', tool: 'UpdateThreadLabels' },
        stepsForRun(older, routine)
      )
    ).toBe('Changed labels');
    expect(
      describeHistoryStep(
        { path: '1.otherwise.0', kind: 'if', answer: true, probability: 0.8 },
        stepsForRun(older, routine)
      )
    ).toBe('Decided yes');

    const step = {
      path: '0',
      kind: 'tool' as const,
      tool: 'UpdateThreadLabels',
    };
    const ran = (revision: number, startedAt: string) => ({
      revision,
      startedAt,
      endedAt: startedAt,
      steps: [step],
    });
    expect(
      latestStepRun([ran(3, '2026-10-01'), ran(2, '2026-10-02')], 3)?.startedAt
    ).toBe('2026-10-01');
    expect(latestStepRun([ran(2, '2026-10-02')], 3)).toBeUndefined();
  });
});
