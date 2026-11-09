import { expect, test } from 'vitest';
import { getStyleObjectFromCSS } from '../dom-style';
import { textFormats, toggleTextFormat } from '../format';

test('subscript, superscript and capitalization toggles keep their exclusive groups', () => {
  expect(
    toggleTextFormat(
      textFormats.superscript | textFormats.bold,
      'subscript',
      null
    )
  ).toBe(textFormats.subscript | textFormats.bold);
  expect(toggleTextFormat(textFormats.subscript, 'superscript', null)).toBe(
    textFormats.superscript
  );
  expect(
    toggleTextFormat(
      textFormats.uppercase | textFormats.italic,
      'capitalize',
      null
    )
  ).toBe(textFormats.capitalize | textFormats.italic);
  expect(toggleTextFormat(textFormats.capitalize, 'lowercase', null)).toBe(
    textFormats.lowercase
  );
  expect(toggleTextFormat(textFormats.lowercase, 'uppercase', null)).toBe(
    textFormats.uppercase
  );
  expect(toggleTextFormat(textFormats.subscript, 'subscript', null)).toBe(0);
});

test('aligning an already matching text format preserves the other group bits', () => {
  expect(
    toggleTextFormat(
      textFormats.bold | textFormats.italic,
      'bold',
      textFormats.bold
    )
  ).toBe(textFormats.bold | textFormats.italic);
  expect(
    toggleTextFormat(textFormats.bold | textFormats.italic, 'bold', 0)
  ).toBe(textFormats.italic);
});

test('inline style parsing preserves quoted separators, data URLs and important values', () => {
  expect(
    getStyleObjectFromCSS(
      'color: red; /* ignored: x; */ content: "a;b:c"; background-image: url("data:image/svg+xml;a:b"); --nested: calc(1px + var(--gap)); font-weight: bold !important'
    )
  ).toEqual({
    color: 'red',
    content: '"a;b:c"',
    'background-image': 'url("data:image/svg+xml;a:b")',
    '--nested': 'calc(1px + var(--gap))',
    'font-weight': 'bold !important',
  });
});
