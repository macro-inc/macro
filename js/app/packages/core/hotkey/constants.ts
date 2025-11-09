import { IS_MAC } from '@core/constant/isMac';

export const shiftPunctuationMap = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  ':': ';',
  '|': '\\',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '~': '`',
  '{': '[',
  '}': ']',
} as const;

export const shiftPunctuationReverseMap = {
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  ';': ':',
  '\\': '|',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~',
  '[': '{',
  ']': '}',
} as const;

export const macOptionReverse = {
  // Option + letters
  å: 'a',
  '∫': 'b',
  ç: 'c',
  '∂': 'd',
  '´': 'e',
  ƒ: 'f',
  '©': 'g',
  '˙': 'h',
  ˆ: 'i',
  '∆': 'j',
  '˚': 'k',
  '¬': 'l',
  µ: 'm',
  ø: 'o',
  π: 'p',
  œ: 'q',
  '®': 'r',
  ß: 's',
  '†': 't',
  '¨': 'u',
  '√': 'v',
  '∑': 'w',
  '≈': 'x',
  '¥': 'y',
  Ω: 'z',

  // Option + Shift + letters
  Å: 'a',
  ı: 'b',
  Ç: 'c',
  Î: 'd',
  Ï: 'f',
  '˝': 'g',
  Ó: 'h',
  Ô: 'j',
  '': 'k',
  Ò: 'l',
  Â: 'm',
  '˜': 'n',
  Ø: 'o',
  '∏': 'p',
  Œ: 'q',
  '‰': 'r',
  Í: 's',
  ˇ: 't',
  '◊': 'v',
  '„': 'w',
  '˛': 'x',
  Á: 'y',
  '¸': 'z',

  // Option + numbers
  '¡': '1',
  '™': '2',
  '£': '3',
  '¢': '4',
  '∞': '5',
  '§': '6',
  '¶': '7',
  '•': '8',
  ª: '9',
  º: '0',

  // Option + Shift + numbers
  '⁄': '1',
  '€': '2',
  '‹': '3',
  '›': '4',
  ﬁ: '5',
  ﬂ: '6',
  '‡': '7',
  '°': '8',
  '·': '9',
  '‚': '0',

  // Option + symbols
  '–': '-',
  '≠': '=',
  '“': '[',
  '‘': ']',
  '«': '\\',
  '…': ';',
  æ: "'",
  '≤': ',',
  '≥': '.',
  '÷': '/',
  '`': '`',

  // Option + Shift + symbols
  '—': '-',
  '±': '=',
  '”': '[',
  '’': ']',
  '»': '\\',
  Ú: ';',
  Æ: "'",
  '¯': ',',
  '˘': '.',
  '¿': '/',
};

export const EVENT_MODIFIER_KEYS = new Set(['meta', 'control', 'alt', 'shift']);

export const CMD_OR_CTRL: 'meta' | 'control' = IS_MAC ? 'meta' : 'control';

export const HOTKEY_TO_EVENT_NAME_MAP = {
  ctrl: 'control',
  opt: 'alt',
  shift: 'shift',
  cmd: CMD_OR_CTRL,
} as const;

export const EVENT_TO_HOTKEY_NAME_MAP = {
  control: 'ctrl',
  alt: 'opt',
  shift: 'shift',
  meta: 'cmd',
  [CMD_OR_CTRL]: 'cmd',
} as const;

export const EVENT_MODIFIER_NAME_MAP = {
  ctrlKey: 'control',
  altKey: 'alt',
  shiftKey: 'shift',
  metaKey: 'meta',
} as const;

export const MODIFIER_LIST_MAC = [
  'ctrlKey',
  'altKey',
  'shiftKey',
  'metaKey',
] as const;

export const MODIFIER_LIST_NON_MAC = ['ctrlKey', 'altKey', 'shiftKey'] as const;
