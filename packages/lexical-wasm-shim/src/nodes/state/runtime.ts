import type { LexicalNode } from '../index';
import type { StateRecord } from './record';
import type { SharedState } from './shared';

export interface StateRuntime {
  readonly getRawState: (node: LexicalNode) => StateRecord | undefined;
  readonly setRawState: (
    node: LexicalNode,
    state: StateRecord | undefined
  ) => void;
  readonly getSharedConfig: (node: LexicalNode) => SharedState;
  readonly latest: <N extends LexicalNode>(node: N) => N;
  readonly writable: <N extends LexicalNode>(node: N) => N;
  readonly errorOnReadOnly: () => void;
}

let stateRuntime: StateRuntime | undefined;
export function bindStateRuntime(runtime: StateRuntime): void {
  stateRuntime = runtime;
}
export function getStateRuntime(): StateRuntime {
  if (stateRuntime === undefined)
    throw new Error('Actual node state runtime has not been bound');
  return stateRuntime;
}
