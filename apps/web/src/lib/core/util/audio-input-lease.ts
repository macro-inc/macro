/** Coordinate browser microphone owners across calls, voice sessions and tabs. */
export async function acquireAudioInputLease(options: {
  required: boolean;
  waitMs?: number;
}): Promise<() => void> {
  if (!navigator.locks) {
    if (options.required)
      throw new Error(
        'Voice needs a browser with microphone session locking. Try a current desktop browser.'
      );
    return () => {};
  }
  const controller = new AbortController();
  const timer = options.waitMs
    ? setTimeout(() => controller.abort(), options.waitMs)
    : undefined;
  return new Promise((resolve, reject) => {
    async function acquire() {
      try {
        await navigator.locks.request(
          'macro-audio-input',
          options.waitMs
            ? { signal: controller.signal }
            : { ifAvailable: true },
          async (lock) => {
            clearTimeout(timer);
            if (!lock)
              throw new Error(
                'Microphone is already in use. End the other call or voice conversation first.'
              );
            await new Promise<void>((release) => resolve(release));
          }
        );
      } catch {
        clearTimeout(timer);
        reject(
          new Error(
            'Microphone is already in use. End the other call or voice conversation first.'
          )
        );
      }
    }
    void acquire();
  });
}
