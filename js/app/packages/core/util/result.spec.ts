import { describe, expect, test, vi } from 'vitest';
import {
  chain,
  combine,
  err,
  isErr,
  isOk,
  type AppResult,
  mapOk,
  logAndUnwrap,
  unwrapOrThrow,
  ok,
  onErr,
  tryCatch,
} from './result';

describe('isErr', () => {
  test('returns false for successful result', () => {
    expect(isErr(ok({}))).toBe(false);
  });

  test('returns true for error result', () => {
    expect(isErr(err('ERROR', 'Test error'))).toBe(true);
  });

  test('matches an error code', () => {
    const result: AppResult<'ERROR' | 'OTHER_ERROR', {}> = err(
      'ERROR',
      'Test error'
    );
    expect(isErr(result, 'ERROR')).toBe(true);
    expect(isErr(result, 'OTHER_ERROR')).toBe(false);
  });
});

describe('isOk', () => {
  test('returns true for successful result', () => {
    expect(isOk(ok({}))).toBe(true);
  });

  test('returns false for error result', () => {
    expect(isOk(err('ERROR', 'Test error'))).toBe(false);
  });
});

describe('unwrapOrThrow', () => {
  test('returns value for successful result', () => {
    expect(unwrapOrThrow(ok({ value: 42 }))).toEqual({ value: 42 });
  });

  test('throws error for error result', () => {
    expect(() => unwrapOrThrow(err('ERROR', 'Test error'))).toThrow(
      'Test error'
    );
  });
});

describe('logAndUnwrap', () => {
  test('returns value for successful result', () => {
    const consoleSpy = vi.spyOn(console, 'error');
    expect(logAndUnwrap(ok({ value: 42 }))).toEqual({ value: 42 });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('logs error and returns undefined for error result', () => {
    const consoleSpy = vi.spyOn(console, 'error');
    expect(logAndUnwrap(err('ERROR', 'Test error'))).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Error:', 'Test error');
    consoleSpy.mockRestore();
  });
});

describe('tryCatch', () => {
  test('returns value for successful function', async () => {
    const successFn = async () => ok({ value: 42 });
    const errorHandler = vi.fn();
    expect(await tryCatch(successFn, errorHandler)).toEqual({ value: 42 });
    expect(errorHandler).not.toHaveBeenCalled();
  });

  test('calls error handler and returns undefined for error function', async () => {
    const errorFn = async () => err('ERROR', 'Test error');
    const errorHandler = vi.fn();
    expect(await tryCatch(errorFn, errorHandler)).toBeUndefined();
    expect(errorHandler).toHaveBeenCalledWith([
      { code: 'ERROR', message: 'Test error' },
    ]);
  });
});

describe('mapOk', () => {
  test('applies function to successful result', () => {
    const result = mapOk(ok({ value: 42 }), (v) => ({ doubled: v.value * 2 }));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ doubled: 84 });
  });

  test('passes through error result', () => {
    const result = mapOk(err('ERROR', 'Test error'), () => ({ doubled: 0 }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual([{ code: 'ERROR', message: 'Test error' }]);
    }
  });
});

describe('chain', () => {
  const double = (v: {
    value: number;
  }): AppResult<string, { doubled: number }> => ok({ doubled: v.value * 2 });

  const square = (v: {
    doubled: number;
  }): AppResult<string, { squared: number }> => ok({ squared: v.doubled ** 2 });

  const errorFn = (): AppResult<string, never> => err('ERROR', 'Test error');

  test('chains multiple successful functions', () => {
    const result = chain(ok({ value: 5 }), double, square);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ squared: 100 });
  });

  test('short-circuits on first error', () => {
    const result = chain(ok({ value: 5 }), double, errorFn, square);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual([{ code: 'ERROR', message: 'Test error' }]);
    }
  });

  test('works with no functions', () => {
    const initial: AppResult<string, { value: number }> = ok({ value: 5 });
    const result = chain(initial);
    expect(result).toBe(initial);
  });
});

describe('combine', () => {
  const result1 = ok({ value: 42 });
  const result2 = ok({ text: 'hello' });
  const result3: AppResult<string, {}> = err('ERROR', 'Test error');

  test('combines multiple successful results', () => {
    const result = combine(result1, result2);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ value: 42 }, { text: 'hello' }]);
    }
  });

  test('returns error when one result is an error', () => {
    const errorResult = combine(result1, result3);
    expect(errorResult.isErr()).toBe(true);
    if (errorResult.isErr()) {
      expect(errorResult.error).toEqual([
        { code: 'ERROR', message: 'Test error' },
      ]);
    }
  });

  test('returns all errors when multiple results are errors', () => {
    const result4: AppResult<string, {}> = err(
      'ANOTHER_ERROR',
      'Another error'
    );
    const errorResult = combine(result1, result3, result4);
    expect(errorResult.isErr()).toBe(true);
    if (errorResult.isErr()) {
      expect(errorResult.error).toEqual([
        { code: 'ERROR', message: 'Test error' },
        { code: 'ANOTHER_ERROR', message: 'Another error' },
      ]);
    }
  });
});

describe('onErr', () => {
  test('returns false for successful result', () => {
    const handlers = { ERROR: vi.fn() };
    expect(onErr(ok({ value: 42 }), handlers)).toBe(false);
    expect(handlers.ERROR).not.toHaveBeenCalled();
  });

  test('calls handler and returns false for non-fatal error', () => {
    const handlers = { NON_FATAL: vi.fn() };
    const result: AppResult<'NON_FATAL', {}> = err(
      'NON_FATAL',
      'Non-fatal error'
    );
    expect(onErr(result, handlers)).toBe(false);
    expect(handlers.NON_FATAL).toHaveBeenCalledWith({
      code: 'NON_FATAL',
      message: 'Non-fatal error',
    });
  });

  test('calls handler and returns true for fatal error', () => {
    const handlers = { FATAL: vi.fn() };
    const result: AppResult<'FATAL', {}> = err('FATAL', 'Fatal error', {
      fatal: true,
    });
    expect(onErr(result, handlers)).toBe(true);
    expect(handlers.FATAL).toHaveBeenCalledWith({
      code: 'FATAL',
      message: 'Fatal error',
      fatal: true,
    });
  });
});
