/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { NodeKey } from 'lexical';
import { createPointWithUpstreamType } from '../compatibility-exceptions';
import type { ElementNode, LexicalNode, TextNode } from '../nodes';
import type { BaseSelection } from './runtime';

export type TextPointType = {
  _selection: BaseSelection;
  getNode: () => TextNode;
  is: (point: PointType) => boolean;
  isBefore: (point: PointType) => boolean;
  key: NodeKey;
  offset: number;
  set: (
    key: NodeKey,
    offset: number,
    type: 'text' | 'element',
    onlyIfChanged?: boolean
  ) => void;
  type: 'text';
};
export type ElementPointType = {
  _selection: BaseSelection;
  getNode: () => ElementNode;
  is: (point: PointType) => boolean;
  isBefore: (point: PointType) => boolean;
  key: NodeKey;
  offset: number;
  set: (
    key: NodeKey,
    offset: number,
    type: 'text' | 'element',
    onlyIfChanged?: boolean
  ) => void;
  type: 'element';
};
export type PointType = TextPointType | ElementPointType;

import { RangeSelection } from './range';
import { getSelectionRuntime } from './runtime';

export class Point {
  declare key: NodeKey;
  declare offset: number;
  declare type: 'text' | 'element';
  declare _selection: BaseSelection | null;

  constructor(key: NodeKey, offset: number, type: 'text' | 'element') {
    if (process.env.NODE_ENV !== 'production') {
      Object.defineProperty(this, '_selection', {
        enumerable: false,
        writable: true,
      });
    }
    this._selection = null;
    this.key = key;
    this.offset = offset;
    this.type = type;
  }

  is(point: PointType): boolean {
    return (
      this.key === point.key &&
      this.offset === point.offset &&
      this.type === point.type
    );
  }

  isBefore(point: PointType): boolean {
    return isPointBefore<import('./runtime').PointCaret<'next'>>(
      this,
      point,
      () => getSelectionRuntime().caret
    );
  }

  getNode(): LexicalNode {
    const node = getSelectionRuntime().getNodeByKey(this.key);
    if (node === null) {
      throw new Error('Point.getNode: node not found');
    }
    return node;
  }

  set(
    key: NodeKey,
    offset: number,
    type: 'text' | 'element',
    onlyIfChanged?: boolean
  ): void {
    if (
      onlyIfChanged &&
      this.key === key &&
      this.offset === offset &&
      this.type === type
    ) {
      return;
    }
    const oldKey = this.key;
    this.key = key;
    this.offset = offset;
    this.type = type;
    const runtime = getSelectionRuntime();
    if (process.env.NODE_ENV !== 'production') {
      const node = runtime.getNodeByKey(key);
      if (
        node === null ||
        !(type === 'text'
          ? runtime.isTextNode(node)
          : runtime.isElementNode(node))
      ) {
        throw new Error(
          `PointType.set: node with key ${key} is ${node?.__type ?? '[not found]'} and can not be used for a ${type} point`
        );
      }
    }
    if (!runtime.isReadOnly()) {
      if (runtime.getCompositionKey() === oldKey) {
        runtime.setCompositionKey(key);
      }
      const selection = this._selection;
      if (selection !== null) {
        selection.setCachedNodes(null);
        if (selection instanceof RangeSelection) {
          selection._cachedIsBackward = null;
        }
        selection.dirty = true;
      }
    }
  }
}

/**
 * Named upstream declaration exception: an owner-less Point has _selection=null
 * and a node-kind-dependent getNode, but v0.45 declares a non-null owner and a
 * discriminated return. Preserve those runtime fields in this single adapter;
 * RangeSelection assigns the owner immediately after construction.
 */
export function $createPoint(
  key: NodeKey,
  offset: number,
  type: 'text' | 'element'
): PointType {
  return createPointWithUpstreamType(key, offset, type);
}

/** Pure pinned ordering algorithm; each producer keeps its own real caret graph. */
export function isPointBefore<C>(
  anchor: import('./runtime').RawSelectionPoint,
  focus: import('./runtime').RawSelectionPoint,
  getCaret: () => {
    $caretFromPoint: (
      point: import('./runtime').RawSelectionPoint,
      direction: 'next'
    ) => C;
    $normalizeCaret: (point: C) => C;
    $comparePointCaretNext: (a: C, b: C) => -1 | 0 | 1;
  }
): boolean {
  if (anchor.key === focus.key) return anchor.offset < focus.offset;
  const caret = getCaret();
  const a = caret.$normalizeCaret(caret.$caretFromPoint(anchor, 'next'));
  const b = caret.$normalizeCaret(caret.$caretFromPoint(focus, 'next'));
  return caret.$comparePointCaretNext(a, b) < 0;
}
