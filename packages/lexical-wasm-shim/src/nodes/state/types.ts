/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { AnyStateConfig as UpstreamAnyStateConfig } from 'lexical';
import type { BaseStaticNodeConfig } from '../config';
import type { LexicalNode } from '../index';
import type { StateConfig } from './config';

export type StateKey = string | symbol;
export type AnyStateConfig = StateConfig<
  UpstreamAnyStateConfig['key'],
  UpstreamAnyStateConfig['defaultValue']
>;
export type StateConfigValue<S extends AnyStateConfig> =
  S extends StateConfig<infer _K, infer V> ? V : never;
export type StateConfigKey<S extends AnyStateConfig> =
  S extends StateConfig<infer K, infer _V> ? K : never;
export type ValueOrUpdater<V> = V | ((prevValue: V) => V);
export type StateValueOrUpdater<Cfg extends AnyStateConfig> = ValueOrUpdater<
  StateConfigValue<Cfg>
>;
export interface NodeStateConfig<S extends AnyStateConfig> {
  stateConfig: S;
  flat?: boolean;
}
export type RequiredNodeStateConfig =
  | NodeStateConfig<AnyStateConfig>
  | AnyStateConfig;
export type StateConfigJSON<S> =
  S extends StateConfig<infer K, infer V>
    ? { [Key in K]?: V }
    : Record<never, never>;
type Spread<A, B> = Omit<B, keyof A> & A;
export type RequiredNodeStateConfigJSON<
  Config extends RequiredNodeStateConfig,
  Flat extends boolean,
> = StateConfigJSON<
  Config extends NodeStateConfig<infer S>
    ? Spread<Config, { flat: false }> extends { flat: Flat }
      ? S
      : never
    : false extends Flat
      ? Config
      : never
>;
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
export type UnionToIntersection<T> = (
  T extends unknown
    ? (value: T) => unknown
    : never
) extends (value: infer R) => unknown
  ? R
  : never;
export type CollectStateJSON<
  Tuple extends readonly RequiredNodeStateConfig[],
  Flat extends boolean,
> = UnionToIntersection<
  { [K in keyof Tuple]: RequiredNodeStateConfigJSON<Tuple[K], Flat> }[number]
>;
type ConfigRecord<Key extends string, Config> = BaseStaticNodeConfig & {
  readonly [K in Key]?: Config;
};
type GetStaticNodeConfig<T extends LexicalNode> =
  ReturnType<T['$config']> extends infer Record
    ? Record extends ConfigRecord<infer Type, infer Config>
      ? Config & { readonly type: Type }
      : never
    : never;
type GetStaticNodeConfigs<T extends LexicalNode> =
  GetStaticNodeConfig<T> extends infer OwnConfig
    ? OwnConfig extends never
      ? []
      : OwnConfig extends { extends: { prototype: infer Parent } }
        ? Parent extends LexicalNode
          ? GetStaticNodeConfig<Parent> extends infer ParentConfig
            ? ParentConfig extends never
              ? [OwnConfig]
              : [OwnConfig, ...GetStaticNodeConfigs<Parent>]
            : OwnConfig
          : [OwnConfig]
        : [OwnConfig]
    : [];
type CollectStateConfigs<Configs> = Configs extends [
  infer OwnConfig,
  ...infer Parents,
]
  ? OwnConfig extends { stateConfigs: infer StateConfigs }
    ? StateConfigs extends readonly RequiredNodeStateConfig[]
      ? [...StateConfigs, ...CollectStateConfigs<Parents>]
      : CollectStateConfigs<Parents>
    : CollectStateConfigs<Parents>
  : [];
export type GetNodeStateConfig<T extends LexicalNode> = CollectStateConfigs<
  GetStaticNodeConfigs<T>
>;
export type NodeStateJSON<T extends LexicalNode> = Prettify<
  {
    $?: Prettify<CollectStateJSON<GetNodeStateConfig<T>, false>>;
  } & CollectStateJSON<GetNodeStateConfig<T>, true>
>;
