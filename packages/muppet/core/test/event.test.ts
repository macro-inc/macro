import { describe, expect, test } from 'bun:test';
import { channel, source } from '../event.ts';

/** A stream over `items` that counts how often it is started and pulled. */
const counted = <T>(items: readonly T[], failAt?: number) => {
  const stats = { starts: 0, pulls: 0 };
  const stream: AsyncIterable<T> = {
    [Symbol.asyncIterator]: () => {
      stats.starts++;
      let index = 0;
      return {
        next: async () => {
          stats.pulls++;
          if (index === failAt) throw new Error('boom');
          const value = items[index++];
          return value === undefined
            ? { done: true, value: undefined }
            : { done: false, value };
        },
      };
    },
  };
  return { stream, stats };
};

/** Reads every event, running `each` on it before asking for the next. */
const read = async <T>(
  events: AsyncIterable<T>,
  each: (event: T) => Promise<void> = async () => {}
): Promise<T[]> => {
  const seen: T[] = [];
  for await (const event of events) {
    seen.push(event);
    await each(event);
  }
  return seen;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const gate = () => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};

describe('source', () => {
  test('delivers every event to a reader, in order', async () => {
    const { stream } = counted([1, 2, 3]);
    expect(await read(source(stream))).toEqual([1, 2, 3]);
  });

  test("doesn't start the stream until it is read", async () => {
    const { stream, stats } = counted([1]);
    source(stream);
    await settle();
    expect(stats.starts).toBe(0);
  });

  test('starts the stream once and gives every reader every event', async () => {
    const { stream, stats } = counted([1, 2, 3]);
    const events = source(stream);
    const [a, b] = await Promise.all([read(events), read(events)]);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(stats.starts).toBe(1);
    expect(stats.pulls).toBe(4); // three events, then the end
  });

  test('pulls again only once every reader has finished the event', async () => {
    const { stream, stats } = counted([1, 2, 3]);
    const events = source(stream);
    const slow = gate();
    const reading = Promise.all([
      read(events),
      read(events, async (event) => {
        if (event === 1) await slow.opened;
      }),
    ]);

    await settle();
    expect(stats.pulls).toBe(1);

    slow.open();
    const [fast, held] = await reading;
    expect(fast).toEqual([1, 2, 3]);
    expect(held).toEqual([1, 2, 3]);
  });

  test('keeps going for the others when a reader leaves early', async () => {
    const { stream } = counted([1, 2, 3]);
    const events = source(stream);
    const leaving = (async () => {
      for await (const event of events) return event;
    })();
    const [left, stayed] = await Promise.all([leaving, read(events)]);
    expect(left).toBe(1);
    expect(stayed).toEqual([1, 2, 3]);
  });

  test('a reader that joins late sees events from then on', async () => {
    const { stream, stats } = counted([1, 2, 3]);
    const events = source(stream);
    let late: Promise<number[]> = Promise.resolve([]);
    const early = await read(events, async (event) => {
      if (event === 2) late = read(events);
    });
    expect(early).toEqual([1, 2, 3]);
    expect(await late).toEqual([3]);
    expect(stats.starts).toBe(1);
  });

  test('passes a stream error to every reader', async () => {
    const { stream } = counted([1, 2, 3], 1);
    const events = source(stream);
    const a: number[] = [];
    const b: number[] = [];
    const results = await Promise.allSettled([
      read(events, async (event) => {
        a.push(event);
      }),
      read(events, async (event) => {
        b.push(event);
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });
});

describe('channel', () => {
  test('push resolves at once when nothing is listening', async () => {
    const { push } = channel<number>();
    await push(1);
  });

  test('push resolves once every reader has finished the event', async () => {
    const { source: events, push, close } = channel<number>();
    const finished: number[] = [];
    const reading = Promise.all([
      read(events, async (n) => {
        await settle();
        finished.push(n);
      }),
      read(events, async (n) => {
        finished.push(n);
      }),
    ]);
    await settle(); // let the readers start

    await push(1);
    expect(finished).toEqual([1, 1]);
    await push(2);
    expect(finished).toEqual([1, 1, 2, 2]);

    close();
    expect(await reading).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });
});
