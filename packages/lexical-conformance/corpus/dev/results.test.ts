import { expect, test } from 'bun:test';
import { evaluate } from './results';

test('paired opaque errors are unverified rather than equal', () => {
  expect(evaluate({ error: 'conversion' }, { error: 'conversion' })).toEqual({
    kind: 'unverified',
    tsError: true,
    rustError: true,
  });
});

test('either snapshot decode failure prevents equality and identifies its side', () => {
  const decode = (value: unknown) => {
    if (value === 'invalid') throw new Error('synthetic');
    return 'deep-state';
  };
  expect(evaluate({ ok: 'invalid' }, { ok: 'valid' }, decode)).toEqual({
    kind: 'different',
    tsError: true,
    rustError: false,
  });
  expect(evaluate({ ok: 'valid' }, { ok: 'invalid' }, decode)).toEqual({
    kind: 'different',
    tsError: false,
    rustError: true,
  });
  expect(evaluate({ ok: 'invalid' }, { ok: 'invalid' }, decode)).toEqual({
    kind: 'different',
    tsError: true,
    rustError: true,
  });
  expect(evaluate({ ok: 'one' }, { ok: 'two' }, decode)).toEqual({
    kind: 'equal',
    tsError: false,
    rustError: false,
  });
  expect(evaluate({ ok: 'one' }, { ok: 'two' }, decode, true)).toEqual({
    kind: 'different',
    tsError: false,
    rustError: false,
  });
});
