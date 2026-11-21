import { Telemetry } from '@macro-inc/observability';
import { afterEach, expect, test, vi } from 'vitest';
import {
  bindCodeTokenCauses,
  type CodeTokenCauseCarrier,
  withCodeTokenCause,
  withSingleCodeTokenCause,
} from './output';

afterEach(() => {
  vi.restoreAllMocks();
});

function record(
  freed: string[],
  ordinals: number[] = [1],
  causes: number[] = [5]
) {
  return {
    entry: 3n,
    effectOrdinals: () => Uint32Array.from(ordinals),
    causes: () => Uint32Array.from(causes),
    free: () => {
      freed.push('free');
    },
  };
}

test('binds the taken value to the effect at its ordinal, once, and frees the record', () => {
  const freed: string[] = [];
  const taken: [bigint, number][] = [];
  const value = { thrown: true };
  const effects: CodeTokenCauseCarrier[] = [{}, {}];
  bindCodeTokenCauses(
    {
      takeCodeTokenFailure: () => record(freed),
      takeCodeTokenCause: (entry, cause) => {
        taken.push([entry, cause]);
        return [value];
      },
    },
    effects
  );
  expect(taken).toEqual([[3n, 5]]);
  expect(freed).toEqual(['free']);
  expect(withCodeTokenCause(new Error('x'), effects[1]).cause).toBe(value);
  expect(
    Object.hasOwn(withCodeTokenCause(new Error('x'), effects[0]), 'cause')
  ).toBe(false);
});

test('frees the record even when taking a cause throws', () => {
  const freed: string[] = [];
  expect(() =>
    bindCodeTokenCauses(
      {
        takeCodeTokenFailure: () => record(freed),
        takeCodeTokenCause: () => {
          throw new Error('take failed');
        },
      },
      [{}, {}]
    )
  ).toThrow('take failed');
  expect(freed).toEqual(['free']);
});

test.each([
  ['no-effect', 'no-effect', [7], [5], (): unknown[] | undefined => ['value']],
  ['no-cause-id', 'no-cause-id', [1], [], () => ['value']],
  [
    'take-missed-undefined',
    'take-missed',
    [1],
    [5],
    (): unknown[] | undefined => undefined,
  ],
  ['take-missed-pair', 'take-missed', [1], [5], () => ['a', 'b']],
] as const)(
  'a %s contract break is reported, binds nothing and frees the record',
  (_label, reason, ordinals, causes, take) => {
    const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    const freed: string[] = [];
    const effects: CodeTokenCauseCarrier[] = [{}, {}];
    bindCodeTokenCauses(
      {
        takeCodeTokenFailure: () => record(freed, [...ordinals], [...causes]),
        takeCodeTokenCause: take,
      },
      effects
    );
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[1]).toEqual({
      surface: 'code-token-cause.binding',
      reason,
      ordinal: ordinals[0],
    });
    expect(effects.every((effect) => !effect.codeTokenCause)).toBe(true);
    expect(freed).toEqual(['free']);
  }
);

test('an error that cannot take a cause is still returned, unchanged', () => {
  const effect: CodeTokenCauseCarrier = { codeTokenCause: { value: 'value' } };
  const error = Object.preventExtensions(new Error('sealed'));
  expect(withCodeTokenCause(error, effect)).toBe(error);
  expect(Object.hasOwn(error, 'cause')).toBe(false);
});

test('the entry error gets the cause only when exactly one failed effect carries one', () => {
  const one = { codeTokenCause: { value: undefined } };
  const other = { codeTokenCause: { value: 'other' } };
  const single = withSingleCodeTokenCause(new Error('one'), [{}, one]);
  expect(Object.hasOwn(single, 'cause')).toBe(true);
  expect(single.cause).toBeUndefined();
  const several = withSingleCodeTokenCause(new Error('two'), [one, other]);
  expect(Object.hasOwn(several, 'cause')).toBe(false);
  const none = withSingleCodeTokenCause(new Error('none'), [{}, {}]);
  expect(Object.hasOwn(none, 'cause')).toBe(false);
});

test('a throwing reporter during a no-effect break does not escape and the record is freed', () => {
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {
    throw new Error('reporter failed');
  });
  const freed: string[] = [];
  expect(() =>
    bindCodeTokenCauses(
      {
        takeCodeTokenFailure: () => record(freed, [7], [5]),
        takeCodeTokenCause: () => ['value'],
      },
      [{}, {}]
    )
  ).not.toThrow();
  expect(freed).toEqual(['free']);
});
