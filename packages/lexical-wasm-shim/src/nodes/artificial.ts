/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */

import type { EditorConfig } from './editor-config';
import { ElementNode } from './index';

/** @internal */
export class ArtificialNode__DO_NOT_USE extends ElementNode {
  static getType(): string {
    return 'artificial';
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement('div');
  }
}
