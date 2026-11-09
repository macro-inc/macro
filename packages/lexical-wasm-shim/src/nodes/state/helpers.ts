/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { LexicalUpdateJSON, SerializedLexicalNode } from 'lexical';
import { applyValueOrUpdater } from '../../compatibility-exceptions';
import type { LexicalNode } from '../index';
import { getStateOperations, type StateConfig } from './config';
import { stateJSONFromNodeJSON } from './json';
import { type NodeState, StateRecord } from './record';
import { getStateRuntime } from './runtime';
import type { SharedState } from './shared';
import type { ValueOrUpdater } from './types';

function checkCollision<K extends string, V>(
  node: LexicalNode,
  config: StateConfig<K, V>,
  state: StateRecord
): void {
  if (process.env.NODE_ENV === 'production') return;
  const collision = state.sharedNodeState.sharedConfigMap.get(config.key);
  if (collision !== undefined && collision !== config)
    throw new Error(
      `$setState: State key collision ${JSON.stringify(config.key)} detected in ${node.constructor.name} node with type ${node.getType()} and key ${node.getKey()}. Only one StateConfig with a given key should be used on a node.`
    );
}

export function $getState<K extends string, V>(
  node: LexicalNode,
  config: StateConfig<K, V>,
  version: 'latest' | 'direct' = 'latest'
): V {
  const runtime = getStateRuntime();
  const capture = version === 'latest' ? runtime.latest(node) : node;
  const state = runtime.getRawState(capture);
  if (state) {
    checkCollision(node, config, state);
    return state.getValue(config);
  }
  return config.defaultValue;
}

export function $getStateChange<T extends LexicalNode, K extends string, V>(
  node: T,
  prevNode: T,
  config: StateConfig<K, V>
): null | [value: V, prevValue: V] {
  const value = $getState(node, config, 'direct');
  const previous = $getState(prevNode, config, 'direct');
  return config.isEqual(value, previous) ? null : [value, previous];
}

function writableRecord(node: LexicalNode): StateRecord {
  const runtime = getStateRuntime();
  const writable = runtime.writable(node);
  const previous = runtime.getRawState(writable);
  const state = previous
    ? previous.getWritable(writable)
    : new StateRecord(writable, runtime.getSharedConfig(writable));
  runtime.setRawState(writable, state);
  return state;
}

export function $getWritableNodeState<T extends LexicalNode>(
  node: T
): NodeState<T> {
  return writableRecord(node);
}

export function $setState<Node extends LexicalNode, K extends string, V>(
  node: Node,
  config: StateConfig<K, V>,
  valueOrUpdater: ValueOrUpdater<V>
): Node {
  const runtime = getStateRuntime();
  runtime.errorOnReadOnly();
  let value: V;
  if (typeof valueOrUpdater === 'function') {
    const latest = runtime.latest(node);
    const previous = $getState(latest, config);
    value = applyValueOrUpdater(valueOrUpdater, previous);
    if (config.isEqual(previous, value)) return latest;
  } else value = valueOrUpdater;
  const writable = runtime.writable(node);
  const state = writableRecord(writable);
  checkCollision(node, config, state);
  state.updateFromKnown(config, value);
  return writable;
}

export function $getSharedNodeState<T extends LexicalNode>(
  node: T
): SharedState {
  const runtime = getStateRuntime();
  return (
    runtime.getRawState(node)?.sharedNodeState || runtime.getSharedConfig(node)
  );
}

export function $updateStateFromJSON<T extends LexicalNode>(
  node: T,
  serialized: LexicalUpdateJSON<SerializedLexicalNode>
): T {
  const runtime = getStateRuntime();
  const writable = runtime.writable(node);
  const parseState = stateJSONFromNodeJSON(
    serialized,
    $getSharedNodeState(writable)
  );
  if (runtime.getRawState(writable) || parseState)
    writableRecord(node).updateFromJSON(parseState);
  return writable;
}

export function $cloneNodeState<T extends LexicalNode>(
  from: T,
  to: T
): StateRecord | undefined {
  const state = getStateRuntime().getRawState(from);
  return state && state.node === from ? state.getWritable(to) : state;
}

function hasUnequalKnown(
  keys: Set<string>,
  source: StateRecord,
  other?: StateRecord
): boolean {
  for (const config of source.knownState.keys()) {
    if (keys.has(config.key)) continue;
    keys.add(config.key);
    if (getStateOperations(config).differs(source, other)) return true;
  }
  return false;
}

function hasUnequalUnknown(
  keys: Set<string>,
  source: StateRecord,
  other?: StateRecord
): boolean {
  if (source.unknownState) {
    for (const [key, value] of Object.entries(source.unknownState)) {
      if (keys.has(key)) continue;
      keys.add(key);
      if (value !== other?.unknownState?.[key]) return true;
    }
  }
  return false;
}

export function nodeStatesAreEquivalent(
  first: StateRecord | undefined,
  second: StateRecord | undefined
): boolean {
  if (first === second) return true;
  const keys = new Set<string>();
  return !(
    (first && hasUnequalKnown(keys, first, second)) ||
    (second && hasUnequalKnown(keys, second, first)) ||
    (first && hasUnequalUnknown(keys, first, second)) ||
    (second && hasUnequalUnknown(keys, second, first))
  );
}
