/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type {
  EditorConfig,
  ElementFormatType,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';

import { DecoratorNode } from 'lexical';

export type SerializedDecoratorBlockNode = Spread<
  {
    format: ElementFormatType;
  },
  SerializedLexicalNode
>;

export class DecoratorBlockNode<T> extends DecoratorNode<T> {
  __format: ElementFormatType;

  constructor(format?: ElementFormatType, key?: NodeKey) {
    super(key);
    this.__format = format || '';
  }

  canIndent(): false {
    return false;
  }

  createDOM(_config?: EditorConfig): HTMLElement {
    return document.createElement('div');
  }

  updateDOM(): boolean {
    return false;
  }

  setFormat(format: ElementFormatType): void {
    const self = this.getWritable();
    self.__format = format;
  }

  isInline(): false {
    return false;
  }
}

export function $isDecoratorBlockNode<T>(
  node: LexicalNode | null | undefined
): node is DecoratorBlockNode<T> {
  return node instanceof DecoratorBlockNode;
}
