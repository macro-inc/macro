/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { AnyStateConfig, RequiredNodeStateConfig } from './types';

/** Actual per-registered-class JS configuration, supplied by the real runtime. */
export class SharedState {
  readonly sharedConfigMap = new Map<string, AnyStateConfig>();
  readonly flatKeys = new Set<string>();

  constructor(configs: readonly RequiredNodeStateConfig[] = []) {
    for (const required of configs) {
      if ('stateConfig' in required) {
        this.sharedConfigMap.set(
          required.stateConfig.key,
          required.stateConfig
        );
        if (required.flat) this.flatKeys.add(required.stateConfig.key);
      } else this.sharedConfigMap.set(required.key, required);
    }
  }
}

export function registerStateConfig(
  shared: SharedState,
  config: AnyStateConfig
): void {
  shared.sharedConfigMap.set(config.key, config);
}
