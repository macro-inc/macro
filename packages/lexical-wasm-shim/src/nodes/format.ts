/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { ElementFormatType, TextFormatType } from 'lexical';

export const textFormats: Readonly<Record<TextFormatType, number>> = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
  lowercase: 256,
  uppercase: 512,
  capitalize: 1024,
};

export const elementFormats: Readonly<Record<ElementFormatType, number>> = {
  '': 0,
  left: 1,
  center: 2,
  right: 3,
  justify: 4,
  start: 5,
  end: 6,
};

export function elementFormat(format: number): ElementFormatType {
  switch (format) {
    case 1:
      return 'left';
    case 2:
      return 'center';
    case 3:
      return 'right';
    case 4:
      return 'justify';
    case 5:
      return 'start';
    case 6:
      return 'end';
    default:
      return '';
  }
}

export function toggleTextFormat(
  format: number,
  type: TextFormatType,
  alignWithFormat: number | null
): number {
  const flag = textFormats[type];
  if (
    alignWithFormat !== null &&
    (format & flag) === (alignWithFormat & flag)
  ) {
    return format;
  }
  let next = format ^ flag;
  if (type === 'subscript') next &= ~textFormats.superscript;
  else if (type === 'superscript') next &= ~textFormats.subscript;
  else if (type === 'lowercase')
    next &= ~(textFormats.uppercase | textFormats.capitalize);
  else if (type === 'uppercase')
    next &= ~(textFormats.lowercase | textFormats.capitalize);
  else if (type === 'capitalize')
    next &= ~(textFormats.lowercase | textFormats.uppercase);
  return next;
}
