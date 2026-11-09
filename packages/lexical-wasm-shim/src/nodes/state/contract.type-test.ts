import type { LexicalNode } from '../index';
import { TextNode } from '../text';
import { createState } from './config';
import {
  $getState,
  $getStateChange,
  $getWritableNodeState,
  $setState,
} from './helpers';
import type { NodeState } from './record';
import type {
  AnyStateConfig,
  NodeStateJSON,
  StateConfigValue,
  StateValueOrUpdater,
} from './types';

const nested = createState('nested', {
  parse: (value: unknown) =>
    typeof value === 'string' ? new Date(value) : new Date(0),
  unparse: (value) => value.toISOString(),
});
const flat = createState('flat', {
  parse: (value: unknown) => (typeof value === 'number' ? value : 0),
});
class ConfiguredText extends TextNode {
  $config() {
    return this.config('configured-state-text', {
      extends: TextNode,
      stateConfigs: [nested, { stateConfig: flat, flat: true }],
    });
  }
}
declare const node: ConfiguredText;
declare const previous: ConfiguredText;
declare const state: NodeState<ConfiguredText>;
export const date: Date = $getState(node, nested);
export const change: [Date, Date] | null = $getStateChange(
  node,
  previous,
  nested
);
export const writable: NodeState<ConfiguredText> = $getWritableNodeState(node);
export const reset: NodeState<ConfiguredText> = state.resetOnCopyNode();
export const sameSubtype: ConfiguredText = $setState(
  node,
  flat,
  (value) => value + 1
);
export const json: NodeStateJSON<ConfiguredText> = state.toJSON();
export const nestedDate: Date | undefined = json.$?.nested;
export const flatCount: number | undefined = json.flat;
export type DateValue = StateConfigValue<typeof nested>;
export const updater: StateValueOrUpdater<typeof nested> = (value) => value;
const callable: () => number = () => 42;
const callableConfig = createState('callable', { parse: () => callable });
export const callableNode: ConfiguredText = $setState(
  node,
  callableConfig,
  callable
);
export const promisedCallable: () => number = $getState(node, callableConfig);
export function acceptsCanonicalAny(
  source: LexicalNode,
  config: AnyStateConfig
): unknown {
  return $getState(source, config);
}
