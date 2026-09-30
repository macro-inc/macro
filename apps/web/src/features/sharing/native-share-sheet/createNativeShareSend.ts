import { createSignal } from 'solid-js';

/** One successful send per mounted share batch, regardless of native cleanup. */
export function createNativeShareSend<T>(options: {
  send: (snapshot: T) => Promise<void>;
  clear: () => Promise<void>;
}) {
  const [state, setState] = createSignal<'idle' | 'sending' | 'sent'>('idle');
  let pending: Promise<void> | undefined;

  const send = (snapshot: T): Promise<void> => {
    if (pending) return pending;
    if (state() === 'sent') return Promise.resolve();
    setState('sending');
    pending = (async () => {
      try {
        await options.send(snapshot);
      } catch (error) {
        setState('idle');
        throw error;
      }
      // A failed acknowledgement must never make a delivered message sendable,
      // nor report the delivered message as a failed send.
      setState('sent');
      try {
        await options.clear();
      } catch (error) {
        console.error('Unable to acknowledge the shared batch', error);
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };

  return { send, canSend: () => state() === 'idle' };
}
