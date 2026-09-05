import { createSignal } from 'solid-js';

/** Progress and completion for one operation, independent of the query library. */
export function createComposeOperation<Input, Output>(
  execute: (input: Input) => Promise<Output>,
  callbacks: {
    onSuccess?: (output: Output, input: Input) => void | Promise<void>;
    onError?: (error: Error, input: Input) => void | Promise<void>;
  } = {}
) {
  const [inFlight, setInFlight] = createSignal(0);
  const [result, setResult] = createSignal<Output>();
  const run = async (input: Input) => {
    setInFlight((count) => count + 1);
    try {
      const output = await execute(input);
      setResult(() => output);
      await callbacks.onSuccess?.(output, input);
      return output;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await callbacks.onError?.(error, input);
      throw error;
    } finally {
      setInFlight((count) => count - 1);
    }
  };
  return {
    pending: () => inFlight() > 0,
    result,
    run,
    start: (input: Input) => {
      void run(input).catch(() => {});
    },
  };
}
