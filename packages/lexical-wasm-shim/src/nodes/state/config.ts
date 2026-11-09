/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */

import { setKnownStateValue } from './known-map';
import type { StateRecord } from './record';
import type { AnyStateConfig, StateKey } from './types';

export interface StateValueConfig<V> {
  parse: (jsonValue: unknown) => V;
  unparse?: (parsed: V) => unknown;
  isEqual?: (a: V, b: V) => boolean;
  resetOnCopyNode?: boolean;
}
interface KnownValue<V> {
  readonly value: V;
}
export interface StateOperations {
  readonly copy: (source: StateRecord, target: StateRecord) => void;
  readonly reset: (record: StateRecord) => void;
  readonly parse: (record: StateRecord, value: unknown) => void;
  readonly parseForCopy: (record: StateRecord, value: unknown) => void;
  readonly serialize: (
    record: StateRecord,
    target: Record<PropertyKey, unknown>
  ) => void;
  readonly differs: (record: StateRecord, other?: StateRecord) => boolean;
}
const operations = new WeakMap<object, StateOperations>();
function coerceToJSON(value: unknown): unknown {
  return value;
}
let readBox: <K extends StateKey, V>(
  config: StateConfig<K, V>,
  record: StateRecord
) => KnownValue<V> | undefined;
let writeBox: <K extends StateKey, V>(
  config: StateConfig<K, V>,
  record: StateRecord,
  value: V
) => void;

export class StateConfig<K extends string | symbol, V> {
  readonly key: K;
  readonly parse: (value?: unknown) => V;
  readonly unparse: (value: V) => unknown;
  readonly isEqual: (a: V, b: V) => boolean;
  readonly defaultValue: V;
  readonly resetOnCopyNode: boolean;
  readonly #values = new WeakMap<StateRecord, KnownValue<V>>();

  static {
    // Keep typed access inside the class without adding public instance hooks.
    readBox = (config, record) => config.#values.get(record);
    writeBox = (config, record, value) => {
      config.#values.set(record, { value });
    };
  }

  constructor(key: K, valueConfig: StateValueConfig<V>) {
    this.key = key;
    this.parse = valueConfig.parse.bind(valueConfig);
    this.unparse = (valueConfig.unparse || coerceToJSON).bind(valueConfig);
    this.isEqual = (valueConfig.isEqual || Object.is).bind(valueConfig);
    this.defaultValue = this.parse(undefined);
    this.resetOnCopyNode = valueConfig.resetOnCopyNode || false;
    const known = (record: StateRecord): V => {
      const box = this.#values.get(record);
      if (box === undefined)
        throw new Error('Known state has no config-owned typed value');
      return box.value;
    };
    operations.set(this, {
      copy: (source, target) => {
        const value = known(source);
        writeTypedValue(this, target, value);
        setKnownStateValue(target.knownState, this, value);
      },
      reset: (record) => {
        const value = this.defaultValue;
        writeTypedValue(this, record, value);
        setKnownStateValue(record.knownState, this, value);
      },
      parse: (record, value) => {
        record.updateFromKnown(this, this.parse(value));
      },
      parseForCopy: (record, input) => {
        const value = this.parse(input);
        writeTypedValue(this, record, value);
        setKnownStateValue(record.knownState, this, value);
      },
      serialize: (record, target) => {
        const value = known(record);
        if (this.isEqual(value, this.defaultValue)) delete target[this.key];
        else target[this.key] = this.unparse(value);
      },
      differs: (record, other) => {
        const value = known(record);
        const otherValue = other ? other.getValue(this) : this.defaultValue;
        return otherValue !== value && !this.isEqual(otherValue, value);
      },
    });
  }
}

export function readTypedValue<K extends StateKey, V>(
  config: StateConfig<K, V>,
  record: StateRecord
): KnownValue<V> | undefined {
  return readBox(config, record);
}
export function writeTypedValue<K extends StateKey, V>(
  config: StateConfig<K, V>,
  record: StateRecord,
  value: V
): void {
  writeBox(config, record, value);
}
export function getStateOperations(config: AnyStateConfig): StateOperations {
  const result = operations.get(config);
  if (result === undefined)
    throw new Error('StateConfig is not owned by this compatibility core');
  return result;
}
export function createState<K extends symbol | string, V>(
  key: K,
  valueConfig: StateValueConfig<V>
): StateConfig<K, V> {
  return new StateConfig(key, valueConfig);
}
