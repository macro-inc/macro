import type { ReplacementRuntime } from './types';

let runtime: ReplacementRuntime | undefined;

export function bindReplacementRuntime(value: ReplacementRuntime): void {
  runtime = value;
}

export function getReplacementRuntime(): ReplacementRuntime {
  if (runtime === undefined)
    throw new Error('Actual node replacement runtime has not been bound');
  return runtime;
}
