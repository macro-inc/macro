import { describe, expect, test, vi } from 'vitest';
import {
  chain,
  combine,
  err,
  isErr,
  isOk,
  type MaybeResult,
  mapOk,
  maybeLog,
  maybeThrow,
  type ObjectLike,
  ok,
  onErr,
  tryCatch,
} from './maybeResult';

describe('isErr', () => {
  test('returns false for null result', () => {
    expect(isErr([null])).toBe(false);
  });

  test('returns false for successful result', () => {
    expect(isErr([null, {}])).toBe(false);
  });

  test('returns true for empty error array', () => {
    expect(isErr([[], null])).toBe(true);
  });

  test('returns true for non-empty error array', () => {
    expect(isErr([[{ code: 'ERROR', message: 'Test error' }], null])).toBe(
      true
    );
  });

  test('returns true for error result without specifying error code', () => {
    expect(isErr([[{ code: 'ERROR', message: 'Test error' }], null])).toBe(
      true
    );
  });

  test('returns true when error code matches', () => {
    const result: MaybeResult<'ERROR' | 'OTHER_ERROR', {}> = [
      [{ code: 'ERROR', message: 'Test error' }],
      null,
    ];
    expect(isErr(result, 'ERROR')).toBe(true);
  });

  test('returns false when error code does not match', () => {
    const result: MaybeResult<'ERROR' | 'OTHER_ERROR', {}> = [
      [{ code: 'ERROR', message: 'Test error' }],
      null,
    ];
    expect(isErr(result, 'OTHER_ERROR')).toBe(false);
  });

  test('returns true when at least one error code matches in multiple errors', () => {
    const result: MaybeResult<'ERROR' | 'OTHER_ERROR', {}> = [
      [
        { code: 'ERROR', message: 'Test error' },
        { code: 'OTHER_ERROR', message: 'Another error' },
      ],
      null,
    ];
    expect(isErr(result, 'OTHER_ERROR')).toBe(true);
  });
});

describe('isOk', () => {
  test('returns true for null result', () => {
    expect(isOk([null])).toBe(true);
  });

  test('returns true for successful result', () => {
    expect(isOk([null, {}])).toBe(true);
  });

  test('returns false for empty error array', () => {
    expect(isOk([[], null])).toBe(false);
  });

  test('returns false for non-empty error array', () => {
    expect(isOk([[{ code: 'ERROR', message: 'Test error' }], null])).toBe(
      false
    );
  });
});

describe('maybeThrow', () => {
  test('returns value for successful result', () => {
    expect(maybeThrow([null, { value: 42 }])).toEqual({ value: 42 });
  });

  test('throws error for error result', () => {
    expect(() =>
      maybeThrow([[{ code: 'ERROR', message: 'Test error' }], null])
    ).toThrow('Test error');
  });
});

describe('maybeLog', () => {
  test('returns value for successful result', () => {
    const consoleSpy = vi.spyOn(console, 'error');
    expect(maybeLog([null, { value: 42 }])).toEqual({ value: 42 });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('logs error and returns undefined for error result', () => {
    const consoleSpy = vi.spyOn(console, 'error');
    expect(
      maybeLog([[{ code: 'ERROR', message: 'Test error' }], null])
    ).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Error:', 'Test error');
    consoleSpy.mockRestore();
  });
});

describe('tryCatch', () => {
  test('returns value for successful function', async () => {
    const successFn = async () =>
      [null, { value: 42 }] as MaybeResult<string, { value: number }>;
    const errorHandler = vi.fn();
    expect(await tryCatch(successFn, errorHandler)).toEqual({ value: 42 });
    expect(errorHandler).not.toHaveBeenCalled();
  });

  test('calls error handler and returns undefined for error function', async () => {
    const errorFn = async () =>
      [[{ code: 'ERROR', message: 'Test error' }], null] as MaybeResult<
        string,
        {}
      >;
    const errorHandler = vi.fn();
    expect(await tryCatch(errorFn, errorHandler)).toBeUndefined();
    expect(errorHandler).toHaveBeenCalledWith([
      { code: 'ERROR', message: 'Test error' },
    ]);
  });
});

describe('mapOk', () => {
  test('applies function to successful result', () => {
    expect(
      mapOk([null, { value: 42 }], (v) => ({ doubled: v.value * 2 }))
    ).toEqual([null, { doubled: 84 }]);
  });

  test('passes through error result', () => {
    expect(
      mapOk([[{ code: 'ERROR', message: 'Test error' }], null], () => ({
        doubled: 0,
      }))
    ).toEqual([[{ code: 'ERROR', message: 'Test error' }], null]);
  });
});

describe('chain', () => {
  const double = (v: {
    value: number;
  }): MaybeResult<string, { doubled: number }> => ok({ doubled: v.value * 2 });

  const square = (v: {
    doubled: number;
  }): MaybeResult<string, { squared: number }> =>
    ok({ squared: v.doubled ** 2 });

  const errorFn = (): MaybeResult<string, never> => err('ERROR', 'Test error');

  test('chains multiple successful functions', () => {
    const result = chain(ok({ value: 5 }), double, square);
    expect(result).toEqual([null, { squared: 100 }]);
  });

  test('short-circuits on first error', () => {
    const result = chain(ok({ value: 5 }), double, errorFn, square);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result[0]).toEqual([{ code: 'ERROR', message: 'Test error' }]);
    }
  });

  test('works with single function', () => {
    const result = chain(ok({ value: 5 }), double);
    expect(result).toEqual([null, { doubled: 10 }]);
  });

  test('works with no functions', () => {
    const initial: MaybeResult<string, { value: number }> = ok({ value: 5 });
    const result = chain(initial);
    expect(result).toEqual(initial);
  });

  test('handles initial error', () => {
    const initial: MaybeResult<string, never> = err(
      'INITIAL_ERROR',
      'Initial error'
    );
    const result = chain(initial, double, square);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result[0]).toEqual([
        { code: 'INITIAL_ERROR', message: 'Initial error' },
      ]);
    }
  });
});
describe('combine', () => {
  const result1: MaybeResult<string, ObjectLike> = [null, { value: 42 }];
  const result2: MaybeResult<string, ObjectLike> = [null, { text: 'hello' }];
  const result3: MaybeResult<string, ObjectLike> = [
    [{ code: 'ERROR', message: 'Test error' }],
    null,
  ];

  test('combines multiple successful results', () => {
    expect(combine(result1, result2)).toEqual([
      null,
      [{ value: 42 }, { text: 'hello' }],
    ]);
  });

  test('returns error when one result is an error', () => {
    const errorResult = combine(result1, result3);
    expect(errorResult[0]).toEqual([{ code: 'ERROR', message: 'Test error' }]);
    expect(errorResult[1]).toEqual(null);
  });

  test('returns all errors when multiple results are errors', () => {
    const result4: MaybeResult<string, ObjectLike> = [
      [{ code: 'ANOTHER_ERROR', message: 'Another error' }],
      null,
    ];
    const errorResult = combine(result1, result3, result4);
    expect(errorResult[0]).toEqual([
      { code: 'ERROR', message: 'Test error' },
      { code: 'ANOTHER_ERROR', message: 'Another error' },
    ]);
    expect(errorResult[1]).toEqual(null);
  });
});

describe('onErr', () => {
  test('returns false for successful result', () => {
    const handlers = {
      ERROR: vi.fn(),
    };
    expect(onErr([null, { value: 42 }], handlers)).toBe(false);
    expect(handlers.ERROR).not.toHaveBeenCalled();
  });

  test('calls handler and returns false for non-fatal error', () => {
    const handlers = {
      NON_FATAL: vi.fn(),
    };
    const result: MaybeResult<'NON_FATAL', {}> = [
      [{ code: 'NON_FATAL', message: 'Non-fatal error' }],
      null,
    ];
    expect(onErr(result, handlers)).toBe(false);
    expect(handlers.NON_FATAL).toHaveBeenCalledWith({
      code: 'NON_FATAL',
      message: 'Non-fatal error',
    });
  });

  test('calls handler and returns true for fatal error', () => {
    const handlers = {
      FATAL: vi.fn(),
    };
    const result: MaybeResult<'FATAL', {}> = [
      [{ code: 'FATAL', message: 'Fatal error', fatal: true }],
      null,
    ];
    expect(onErr(result, handlers)).toBe(true);
    expect(handlers.FATAL).toHaveBeenCalledWith({
      code: 'FATAL',
      message: 'Fatal error',
      fatal: true,
    });
  });

  test('calls multiple handlers for multiple non-fatal errors', () => {
    const handlers = {
      ERROR1: vi.fn(),
      ERROR2: vi.fn(),
    };
    const result: MaybeResult<'ERROR1' | 'ERROR2', {}> = [
      [
        { code: 'ERROR1', message: 'First error' },
        { code: 'ERROR2', message: 'Second error' },
      ],
      null,
    ];
    expect(onErr(result, handlers)).toBe(false);
    expect(handlers.ERROR1).toHaveBeenCalledWith({
      code: 'ERROR1',
      message: 'First error',
    });
    expect(handlers.ERROR2).toHaveBeenCalledWith({
      code: 'ERROR2',
      message: 'Second error',
    });
  });

  test('stops after encountering a fatal error', () => {
    const handlers = {
      NON_FATAL: vi.fn(),
      FATAL: vi.fn(),
      AFTER_FATAL: vi.fn(),
    };
    const result: MaybeResult<'NON_FATAL' | 'FATAL' | 'AFTER_FATAL', {}> = [
      [
        { code: 'NON_FATAL', message: 'Non-fatal error' },
        { code: 'FATAL', message: 'Fatal error', fatal: true },
        { code: 'AFTER_FATAL', message: 'This should not be processed' },
      ],
      null,
    ];
    expect(onErr(result, handlers)).toBe(true);
    expect(handlers.NON_FATAL).toHaveBeenCalled();
    expect(handlers.FATAL).toHaveBeenCalled();
    expect(handlers.AFTER_FATAL).not.toHaveBeenCalled();
  });
});

// ... (rest of the file remains unchanged)
