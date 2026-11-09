/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { nodeStateToJSON } from '../../compatibility-exceptions';
import type { LexicalNode } from '../index';
import {
  getStateOperations,
  readTypedValue,
  type StateConfig,
  writeTypedValue,
} from './config';
import { createKnownStateMap, setKnownStateValue } from './known-map';
import { registerStateConfig, type SharedState } from './shared';
import type { AnyStateConfig, NodeStateJSON, StateKey } from './types';

export type UnknownStateRecord = Record<string, unknown>;
export type KnownStateMap = Map<AnyStateConfig, unknown>;

function undefinedIfEmpty(
  value: UnknownStateRecord
): UnknownStateRecord | undefined {
  for (const _key in value) return value;
  return undefined;
}

/** Non-generic JS backing record; generic values remain in each config's store. */
export class StateRecord {
  readonly knownState: KnownStateMap = createKnownStateMap();
  unknownState: UnknownStateRecord | undefined;
  size: number;

  constructor(
    readonly node: LexicalNode,
    readonly sharedNodeState: SharedState,
    unknownState?: UnknownStateRecord
  ) {
    this.unknownState = unknownState;
    this.size = 0;
    if (unknownState) {
      for (const _key in unknownState) this.size++;
    }
  }

  getValue<K extends StateKey, V>(config: StateConfig<K, V>): V {
    const known = readTypedValue(config, this);
    if (known?.value !== undefined) return known.value;
    registerStateConfig(this.sharedNodeState, config);
    let parsed = config.defaultValue;
    if (this.unknownState && config.key in this.unknownState) {
      const value: unknown = Reflect.get(this.unknownState, config.key);
      if (value !== undefined) parsed = config.parse(value);
      this.updateFromKnown(config, parsed);
    }
    return parsed;
  }

  getInternalState(): [
    { readonly [key in string]: unknown } | undefined,
    ReadonlyMap<AnyStateConfig, unknown>,
  ] {
    return [this.unknownState, this.knownState];
  }

  toJSON<T extends LexicalNode>(): NodeStateJSON<T> {
    const state: Record<PropertyKey, unknown> = { ...this.unknownState };
    const flat: Record<PropertyKey, unknown> = {};
    for (const config of this.knownState.keys()) {
      getStateOperations(config).serialize(this, state);
    }
    for (const key of this.sharedNodeState.flatKeys) {
      if (key in state) {
        flat[key] = state[key];
        delete state[key];
      }
    }
    for (const _key in state) {
      flat.$ = state;
      break;
    }
    return nodeStateToJSON<T>(flat);
  }

  getWritable(node: LexicalNode): StateRecord {
    if (this.node === node) return this;
    const next = new StateRecord(node, this.sharedNodeState);
    for (const config of this.knownState.keys())
      getStateOperations(config).copy(this, next);
    if (this.unknownState) {
      let remaining: UnknownStateRecord | undefined;
      for (const [key, value] of Object.entries(this.unknownState)) {
        const config = this.sharedNodeState.sharedConfigMap.get(key);
        if (config) {
          if (!next.knownState.has(config))
            getStateOperations(config).parseForCopy(next, value);
        } else {
          remaining = remaining || {};
          remaining[key] = value;
        }
      }
      next.unknownState = remaining;
    }
    next.size = this.size;
    return next;
  }

  resetOnCopyNode(): this {
    for (const config of this.knownState.keys()) {
      if (config.resetOnCopyNode) getStateOperations(config).reset(this);
    }
    return this;
  }

  updateFromKnown<K extends StateKey, V>(
    config: StateConfig<K, V>,
    value: V
  ): void {
    registerStateConfig(this.sharedNodeState, config);
    if (
      !(
        this.knownState.has(config) ||
        (this.unknownState && config.key in this.unknownState)
      )
    ) {
      if (this.unknownState) {
        Reflect.deleteProperty(this.unknownState, config.key);
        this.unknownState = undefinedIfEmpty(this.unknownState);
      }
      this.size++;
    }
    writeTypedValue(config, this, value);
    setKnownStateValue(this.knownState, config, value);
  }

  updateFromUnknown(key: string, value: unknown): void {
    const config = this.sharedNodeState.sharedConfigMap.get(key);
    if (config) getStateOperations(config).parse(this, value);
    else {
      this.unknownState = this.unknownState || {};
      if (!(key in this.unknownState)) this.size++;
      this.unknownState[key] = value;
    }
  }

  updateFromJSON(unknownState: UnknownStateRecord | undefined): void {
    for (const config of this.knownState.keys())
      getStateOperations(config).reset(this);
    this.size = this.knownState.size;
    this.unknownState = undefined;
    if (unknownState) {
      for (const [key, value] of Object.entries(unknownState))
        this.updateFromUnknown(key, value);
    }
  }
}

/** Public state contract, structurally implemented by the actual backing record. */
export interface NodeState<T extends LexicalNode> {
  readonly node: LexicalNode;
  readonly knownState: KnownStateMap;
  unknownState: UnknownStateRecord | undefined;
  readonly sharedNodeState: SharedState;
  size: number;
  getValue<K extends string, V>(config: StateConfig<K, V>): V;
  getInternalState(): [
    { readonly [key in string]: unknown } | undefined,
    ReadonlyMap<AnyStateConfig, unknown>,
  ];
  toJSON(): NodeStateJSON<T>;
  getWritable(node: T): NodeState<T>;
  resetOnCopyNode(): this;
  updateFromKnown<K extends string, V>(
    config: StateConfig<K, V>,
    value: V
  ): void;
  updateFromUnknown(key: string, value: unknown): void;
  updateFromJSON(unknownState: UnknownStateRecord | undefined): void;
}
