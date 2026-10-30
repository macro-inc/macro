import { describe, expect, it } from 'vitest';
import { stepsFromTask } from './routine-steps';
import { describeHistoryStep, stepAtPath } from './step-history';

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
    ).toBe('Send Channel Message');
  });
});
