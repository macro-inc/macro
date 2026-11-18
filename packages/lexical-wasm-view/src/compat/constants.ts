/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// Retargeted from lexical@0.45.0; model operations are injected by runtime.ts.
import { IS_APPLE_WEBKIT, IS_FIREFOX, IS_IOS, IS_SAFARI } from './environment';

// DOM
export const DOM_ELEMENT_TYPE = 1;

export const DOM_TEXT_TYPE = 3;

export const DOM_DOCUMENT_TYPE = 9;

export const DOM_DOCUMENT_FRAGMENT_TYPE = 11;

export const FULL_RECONCILE = 2;

// IS_INERT = 3

// Text node formatting
export const IS_BOLD = 1;

export const IS_ITALIC = 1 << 1;

export const IS_STRIKETHROUGH = 1 << 2;

export const IS_UNDERLINE = 1 << 3;

export const IS_CODE = 1 << 4;

export const IS_SUBSCRIPT = 1 << 5;

export const IS_SUPERSCRIPT = 1 << 6;

export const IS_HIGHLIGHT = 1 << 7;

export const IS_LOWERCASE = 1 << 8;

export const IS_UPPERCASE = 1 << 9;

export const IS_CAPITALIZE = 1 << 10;

export const IS_ALL_FORMATTING =
  IS_BOLD |
  IS_ITALIC |
  IS_STRIKETHROUGH |
  IS_UNDERLINE |
  IS_CODE |
  IS_SUBSCRIPT |
  IS_SUPERSCRIPT |
  IS_HIGHLIGHT |
  IS_LOWERCASE |
  IS_UPPERCASE |
  IS_CAPITALIZE;

// Element node formatting
export const IS_ALIGN_LEFT = 1;

export const IS_ALIGN_CENTER = 2;

export const IS_ALIGN_RIGHT = 3;

export const IS_ALIGN_JUSTIFY = 4;

export const IS_ALIGN_START = 5;

export const IS_ALIGN_END = 6;

// Reconciliation
export const NON_BREAKING_SPACE = '\u00A0';

export const ZERO_WIDTH_SPACE = '\u200b';

// For iOS/Safari we use a non breaking space, otherwise the cursor appears
// overlapping the composed text.
export const COMPOSITION_SUFFIX: string =
  IS_SAFARI || IS_IOS || IS_APPLE_WEBKIT
    ? NON_BREAKING_SPACE
    : ZERO_WIDTH_SPACE;

export const DOUBLE_LINE_BREAK = '\n\n';

// For FF, we need to use a non-breaking space, or it gets composition
// in a stuck state.
export const COMPOSITION_START_CHAR: string = IS_FIREFOX
  ? NON_BREAKING_SPACE
  : COMPOSITION_SUFFIX;
