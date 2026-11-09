/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { widenTagConversionMap } from '../compatibility-exceptions';
import type { DOMConversionMap, DOMConversionPropByTagName } from './dom-types';

export function buildImportMap<K extends string>(
  importMap: {
    [NodeName in K]: DOMConversionPropByTagName<NodeName>;
  }
): DOMConversionMap {
  return widenTagConversionMap(importMap);
}
