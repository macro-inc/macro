/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { SerializedLexicalNode } from 'lexical';
import type { DOMConversionMap } from './dom-types';
import type { LexicalNode } from './index';
import type { RequiredNodeStateConfig } from './state/types';

export type { StaticNodeConfigRecord } from 'lexical';

export interface StaticNodeConfigValue<
  T extends LexicalNode,
  Type extends string,
> {
  readonly type?: Type;
  readonly $transform?: (node: T) => void;
  readonly $importJSON?: (serializedNode: SerializedLexicalNode) => T;
  readonly importDOM?: DOMConversionMap;
  readonly stateConfigs?: readonly RequiredNodeStateConfig[];
  readonly extends?: LexicalNode['constructor'];
}

export type BaseStaticNodeConfig = {
  readonly [K in string]?: StaticNodeConfigValue<LexicalNode, string>;
};
