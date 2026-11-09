/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { LexicalUpdateJSON, SerializedLexicalNode } from 'lexical';
import type { UnknownStateRecord } from './record';
import type { SharedState } from './shared';

export function stateJSONFromNodeJSON(
  serialized: LexicalUpdateJSON<SerializedLexicalNode>,
  shared: SharedState
): UnknownStateRecord | undefined {
  const unknownState = serialized.$;
  let parseState = unknownState;
  for (const key of shared.flatKeys) {
    if (key in serialized) {
      if (parseState === undefined || parseState === unknownState)
        parseState = { ...unknownState };
      const value: unknown = Reflect.get(serialized, key);
      parseState[key] = value;
    }
  }
  return parseState;
}
