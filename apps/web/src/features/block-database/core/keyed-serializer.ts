/**
 * Tasks sharing a key run one at a time, in the order they were queued;
 * tasks under different keys run independently. A key with nothing queued
 * holds no state.
 */
export type KeyedSerializer = {
  run: <Value>(key: string, task: () => Promise<Value>) => Promise<Value>;
};

export function createKeyedSerializer(): KeyedSerializer {
  const tails = new Map<string, Promise<void>>();
  /** Drop the key once its last queued task settles with nothing after it. */
  async function forgetWhenIdle(key: string, settled: Promise<void>) {
    await settled;
    if (tails.get(key) === settled) tails.delete(key);
  }
  return {
    run<Value>(key: string, task: () => Promise<Value>): Promise<Value> {
      const previous = tails.get(key);
      const result = (async () => {
        await previous;
        return await task();
      })();
      const settled = (async () => {
        try {
          await result;
        } catch {
          // The caller awaits `result` and sees its rejection.
        }
      })();
      tails.set(key, settled);
      void forgetWhenIdle(key, settled);
      return result;
    },
  };
}
