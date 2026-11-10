import { describe, expect, it } from 'vitest';
import { stepsFromWire } from './routine-steps';
import {
  describeHistoryStep,
  runDays,
  runOutcome,
  stepAtPath,
  stepsForRun,
  summarizeRun,
} from './step-history';

const steps =
  stepsFromWire([
    {
      type: 'code',
      title: 'Label invoices',
      source: 'export async function main() {}',
    },
    { type: 'agent', model: 'm', instructions: 'Go' },
  ]) ?? [];

const call = (write: boolean) => ({
  operation: 'email.addLabel',
  label: 'Add Label',
  write,
  status: 'completed' as const,
  startedMs: 0,
});

describe('routine step history', () => {
  it('finds steps by their recorded path', () => {
    expect(stepAtPath(steps, '0')?.kind).toBe('code');
    expect(stepAtPath(steps, '1')?.kind).toBe('agent');
    expect(stepAtPath(steps, '7')).toBeUndefined();
    expect(stepAtPath(undefined, '0')).toBeUndefined();
  });

  it('describes what a run did with the step labels', () => {
    const ran = {
      path: '0',
      kind: 'code' as const,
      calls: [],
      callsTruncated: false,
    };
    expect(describeHistoryStep(ran, steps)).toBe('Label invoices');
    expect(describeHistoryStep({ ...ran, error: 'No access' }, steps)).toBe(
      'Label invoices failed: No access'
    );
    expect(describeHistoryStep({ path: '1', kind: 'agent' }, steps)).toBe(
      'Asked AI'
    );
    // A step the routine no longer has still reads sensibly.
    expect(describeHistoryStep({ ...ran, path: '9' }, steps)).toBe('Ran code');
  });

  it('reads a run against the steps of the configuration it ran', () => {
    const routine = { revision: 3, draft: { steps } };
    const run = { revision: 3, steps: [] };
    expect(stepsForRun(run, routine)).toBe(steps);
    // After an edit, the same path can hold another step.
    expect(stepsForRun({ ...run, revision: 2 }, routine)).toBeUndefined();
  });
});

describe('routine run outcomes', () => {
  const ran = { id: 'run', success: true };

  it('tells skipped and no-change runs apart from successes', () => {
    expect(runOutcome({ ...ran, id: undefined })).toBe('running');
    expect(runOutcome({ ...ran, success: false })).toBe('failed');
    const skipped = {
      ...ran,
      skipped: { reason: 'not_met' as const, probability: 0.1 },
    };
    expect(runOutcome(skipped)).toBe('skipped');
    // A condition-skipped run is not a run that "Ran".
    expect(summarizeRun(skipped, undefined)).toBe('Skipped: condition not met');
    expect(
      summarizeRun(
        { ...ran, skipped: { reason: 'unavailable' }, error: 'Down' },
        undefined
      )
    ).toBe('Skipped: condition couldn’t be checked');
    // Code that only read changed nothing; a write that went through did.
    const code = (write: boolean) => ({
      ...ran,
      steps: [
        {
          path: '0',
          kind: 'code' as const,
          calls: [call(write)],
          callsTruncated: false,
        },
      ],
    });
    expect(runOutcome(code(false))).toBe('nothing');
    expect(runOutcome(code(true))).toBe('succeeded');
    expect(
      summarizeRun(
        {
          ...ran,
          success: false,
          steps: [{ path: '0', kind: 'agent', error: 'Gone' }],
        },
        undefined
      )
    ).toBe('Failed: Gone');
  });

  it('groups runs under Today, Yesterday and their date', () => {
    const now = new Date(2026, 9, 30, 12);
    const at = (day: number, hour: number) =>
      new Date(2026, 9, day, hour).toISOString();
    const days = runDays(
      [
        { id: 'a', startedAt: at(30, 9) },
        { id: 'b', startedAt: at(30, 8) },
        { id: 'c', startedAt: at(29, 17) },
        { id: 'd', startedAt: at(20, 9) },
        { id: 'e' },
      ],
      now
    );
    expect(
      days.map((day) => [day.label, day.records.map((r) => r.id)])
    ).toEqual([
      ['Today', ['a', 'b', 'e']],
      ['Yesterday', ['c']],
      [expect.stringMatching(/Oct 20/), ['d']],
    ]);
  });
});
