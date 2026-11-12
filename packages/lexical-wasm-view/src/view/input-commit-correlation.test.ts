/** Pure JS numbering/guard machinery only; this fixture is not a native session. */
import { expect, test } from 'vitest';
import {
  InputCommitCorrelationExhausted,
  mintInputCommitCorrelation,
  recordGuardedInputCommitCorrelation,
} from './input-commit-correlation';
import { installNativeSessionReceiverGuard } from './native-session-guard';

test('numbering is shared for one receiver and independent across receivers', () => {
  const first = {};
  const second = {};
  recordGuardedInputCommitCorrelation(first, '40');
  expect(mintInputCommitCorrelation(first)).toEqual({
    entryId: 41n,
    text: '41',
  });
  expect(mintInputCommitCorrelation(second)).toEqual({
    entryId: 1n,
    text: '1',
  });
  recordGuardedInputCommitCorrelation(first, '1');
  expect(mintInputCommitCorrelation(first).entryId).toBe(42n);
});

test('invalid canonical strings do not advance and maximum never wraps', () => {
  const receiver = {};
  for (const invalid of [
    '',
    '0',
    '01',
    '-1',
    '+1',
    ' 2',
    '2 ',
    '1e3',
    '１',
    '18446744073709551616',
    '999999999999999999999999999999',
  ])
    recordGuardedInputCommitCorrelation(receiver, invalid);
  expect(mintInputCommitCorrelation(receiver).entryId).toBe(1n);
  recordGuardedInputCommitCorrelation(receiver, '18446744073709551615');
  expect(() => mintInputCommitCorrelation(receiver)).toThrow(
    InputCommitCorrelationExhausted
  );
  expect(() => mintInputCommitCorrelation(receiver)).toThrow(
    InputCommitCorrelationExhausted
  );
});

test('guard preserves alias identity and records only after active admission', () => {
  let delegated = 0;
  let active = false;
  class Receiver {
    alias(_bytes: unknown, _now: unknown, _wall: unknown, _id: string): void {
      delegated++;
    }
  }
  // Visit alias first during preflight, then register the same original as
  // inputObserved. The existing wrapper cache must still produce one function.
  Object.defineProperty(Receiver.prototype, 'inputObserved', {
    value: Receiver.prototype.alias,
    configurable: true,
    writable: true,
  });
  installNativeSessionReceiverGuard(Receiver, { active: () => active });
  expect(
    Object.getOwnPropertyDescriptor(Receiver.prototype, 'inputObserved')?.value
  ).toBe(Receiver.prototype.alias);
  const receiver = new Receiver();
  receiver.alias(undefined, undefined, undefined, '9');
  expect(mintInputCommitCorrelation(receiver).entryId).toBe(10n);
  active = true;
  expect(() => receiver.alias(undefined, undefined, undefined, '200')).toThrow(
    'scoped callback'
  );
  active = false;
  expect(mintInputCommitCorrelation(receiver).entryId).toBe(11n);
  expect(delegated).toBe(1);
});

test('nonprimitive rejection does not coerce, delegate or complete a receiver entry', () => {
  let delegated = 0;
  let coercions = 0;
  class Receiver {
    inputObserved(
      _bytes: unknown,
      _now: unknown,
      _wall: unknown,
      _id: string
    ): void {
      delegated++;
    }
  }
  const guard = installNativeSessionReceiverGuard(Receiver, {
    active: () => false,
  });
  const receiver = new Receiver();
  const value = {
    get toString() {
      coercions++;
      return () => '90';
    },
  };
  const before = guard.completedEntryToken();
  expect(() =>
    Reflect.apply(receiver.inputObserved, receiver, [
      undefined,
      undefined,
      undefined,
      value,
    ])
  ).toThrow(TypeError);
  expect(guard.completedEntryToken()).toBe(before);
  expect(delegated).toBe(0);
  expect(coercions).toBe(0);
  expect(mintInputCommitCorrelation(receiver).entryId).toBe(1n);
});

test('a valid throwing attempt advances, while cleaning rejection does not', () => {
  let cleaningRejected = false;
  let receiver: Receiver | undefined;
  class Receiver {
    inputObserved(
      _bytes: unknown,
      _now: unknown,
      _wall: unknown,
      _id: string
    ): void {
      throw undefined;
    }
  }
  const guard = installNativeSessionReceiverGuard(Receiver, {
    active: () => false,
    afterReturn() {
      try {
        receiver?.inputObserved(undefined, undefined, undefined, '200');
      } catch {
        cleaningRejected = true;
      }
    },
  });
  receiver = new Receiver();
  let caught: { error: unknown } | undefined;
  try {
    receiver.inputObserved(undefined, undefined, undefined, '20');
  } catch (error) {
    caught = { error };
  }
  expect(caught).toEqual({ error: undefined });
  expect(cleaningRejected).toBe(true);
  expect(guard.completedEntryToken()).toBe(1n);
  expect(mintInputCommitCorrelation(receiver).entryId).toBe(21n);
});
