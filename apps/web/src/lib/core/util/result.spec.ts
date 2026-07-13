import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { catchToResult, ThrownResultError, throwOnErr } from './result';

describe('throwOnErr', () => {
  it('returns ok values', async () => {
    await expect(throwOnErr(async () => ok({ value: 42 }))).resolves.toEqual({
      value: 42,
    });
  });

  it('throws a ThrownResultError for err values', async () => {
    const error = [{ code: 'ERROR', message: 'Test error' }];

    await expect(throwOnErr(async () => err(error))).rejects.toMatchObject({
      errors: error,
      message: 'Test error',
    });
  });
});

describe('catchToResult', () => {
  it('returns ok values', async () => {
    const result = await catchToResult(async () => ({ value: 42 }));

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ value: 42 });
  });

  it('preserves thrown result errors', async () => {
    const errors = [{ code: 'ERROR', message: 'Test error' }];
    const result = await catchToResult(async () => {
      throw new ThrownResultError(errors);
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toEqual(errors);
  });

  it('converts regular thrown errors', async () => {
    const result = await catchToResult(async () => {
      throw new Error('Boom');
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual([{ code: 'UNKNOWN', message: 'Boom' }]);
    }
  });
});
