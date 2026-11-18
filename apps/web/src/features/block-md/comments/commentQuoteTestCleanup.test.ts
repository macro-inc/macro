import { expect, test, vi } from 'vitest';
import { finishQuoteControl } from './commentQuoteTestCleanup';

async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
    return { threw: false, value: undefined };
  } catch (value) {
    return { threw: true, value };
  }
}

test.each([undefined, null, Object.freeze({ kind: 'opaque primary' })])(
  'quote cleanup preserves the exact primary value despite a throwing reporter: %s',
  async (primary) => {
    const cleanup = Object.freeze({ kind: 'cleanup failure' });
    const diagnostic = Object.freeze({ kind: 'diagnostic failure' });
    const order: string[] = [];
    const report = vi.fn(() => {
      throw diagnostic;
    });
    const result = await outcome(
      finishQuoteControl(
        { error: primary },
        [
          () => {
            order.push('first');
            throw cleanup;
          },
          () => {
            order.push('later');
          },
        ],
        report
      )
    );
    expect(result.threw).toBe(true);
    expect(result.value).toBe(primary);
    expect(order).toEqual(['first', 'later']);
    expect(report).toHaveBeenCalledExactlyOnceWith(cleanup);
  }
);

test('quote cleanup preserves its first failure and still attempts every later step', async () => {
  const first = Object.freeze({ kind: 'first cleanup' });
  const second = Object.freeze({ kind: 'second cleanup' });
  const diagnostic = Object.freeze({ kind: 'diagnostic' });
  const order: string[] = [];
  const report = vi.fn(() => {
    throw diagnostic;
  });
  const result = await outcome(
    finishQuoteControl(
      undefined,
      [
        () => {
          order.push('first');
          throw first;
        },
        () => {
          order.push('second');
          throw second;
        },
        () => {
          order.push('third');
        },
      ],
      report
    )
  );
  expect(result.threw).toBe(true);
  expect(result.value).toBe(first);
  expect(order).toEqual(['first', 'second', 'third']);
  expect(report).toHaveBeenCalledExactlyOnceWith(second);
});
