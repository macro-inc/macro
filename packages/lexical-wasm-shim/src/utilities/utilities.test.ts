import * as Original from 'lexical';
import { expect, test } from 'vitest';
import { normalizeClassNames as viewClassNames } from '../../../lexical-wasm-view/src/compat/support';
import * as Actual from './index';

test('class helpers share the view tokenizer and preserve Original whitespace and ignored values', () => {
  expect(Actual.normalizeClassNames).toBe(viewClassNames);
  const actual = document.createElement('div');
  const original = document.createElement('div');
  const inputs = [
    'first\tsecond',
    false,
    ' second\nthird ',
    null,
    true,
    undefined,
    '\u00a0last',
  ];
  expect(Actual.normalizeClassNames(...inputs)).toEqual(
    Original.normalizeClassNames(...inputs)
  );
  Actual.addClassNamesToElement(actual, ...inputs);
  Original.addClassNamesToElement(original, ...inputs);
  expect(actual.className).toBe(original.className);
  Actual.removeClassNamesFromElement(actual, 'first last', false);
  Original.removeClassNamesFromElement(original, 'first last', false);
  expect(actual.className).toBe(original.className);
});

test('DOM predicates and first-child text traversal match Original on actual DOM nodes', () => {
  const parent = document.createElement('div');
  parent.innerHTML = '<span></span><span>later</span>';
  expect(Actual.getDOMTextNode(parent)).toBe(Original.getDOMTextNode(parent));
  parent.firstChild?.appendChild(document.createTextNode('first'));
  expect(Actual.getDOMTextNode(parent)).toBe(Original.getDOMTextNode(parent));
  const fragment = document.createDocumentFragment();
  const values = [
    document,
    parent,
    parent.firstChild,
    document.createTextNode('text'),
    fragment,
    document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    null,
    0,
  ];
  for (const value of values) {
    expect(Actual.isDOMNode(value)).toBe(Original.isDOMNode(value));
    expect(Actual.isHTMLElement(value)).toBe(Original.isHTMLElement(value));
    expect(Actual.isDOMDocumentNode(value)).toBe(
      Original.isDOMDocumentNode(value)
    );
    expect(Actual.isDOMTextNode(value)).toBe(Original.isDOMTextNode(value));
    expect(Actual.isDocumentFragment(value)).toBe(
      Original.isDocumentFragment(value)
    );
  }
  for (const tag of ['a', 'tr', 'td', 'th', 'p', 'span', 'video']) {
    const element = document.createElement(tag);
    expect(Actual.isHTMLAnchorElement(element)).toBe(
      Original.isHTMLAnchorElement(element)
    );
    expect(Actual.isHTMLTableRowElement(element)).toBe(
      Original.isHTMLTableRowElement(element)
    );
    expect(Actual.isHTMLTableCellElement(element)).toBe(
      Original.isHTMLTableCellElement(element)
    );
    for (const display of ['', 'inline-block', 'block']) {
      element.style.display = display;
      expect(Actual.isInlineDomNode(element)).toBe(
        Original.isInlineDomNode(element)
      );
      expect(Actual.isBlockDomNode(element)).toBe(
        Original.isBlockDomNode(element)
      );
    }
  }
  expect(Actual.getDOMOwnerDocument(document)).toBe(
    Original.getDOMOwnerDocument(document)
  );
  expect(Actual.getDOMOwnerDocument(parent)).toBe(
    Original.getDOMOwnerDocument(parent)
  );
  expect(Actual.getDOMSelection(window)).toBe(Original.getDOMSelection(window));
  expect(Actual.getDOMSelectionFromTarget(parent)).toBe(
    Original.getDOMSelectionFromTarget(parent)
  );
});

test('unmanaged markers and propagation preserve original property setters and opaque throws', () => {
  const actual = document.createElement('div');
  const original = document.createElement('div');
  expect(Actual.isDOMUnmanaged(actual)).toBe(Original.isDOMUnmanaged(original));
  Actual.setDOMUnmanaged(actual);
  Original.setDOMUnmanaged(original);
  expect(Actual.isDOMUnmanaged(actual)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(actual, '__lexicalUnmanaged')).toEqual(
    Object.getOwnPropertyDescriptor(original, '__lexicalUnmanaged')
  );
  const event = new Event('test');
  const opaque = { reason: 'event property setter' };
  let calls = 0;
  Object.defineProperty(event, '_lexicalHandled', {
    set(value: unknown) {
      calls++;
      expect(value).toBe(true);
      throw opaque;
    },
  });
  let actualError: unknown;
  let originalError: unknown;
  try {
    Actual.stopLexicalPropagation(event);
  } catch (error) {
    actualError = error;
  }
  try {
    Original.stopLexicalPropagation(event);
  } catch (error) {
    originalError = error;
  }
  expect(actualError).toBe(opaque);
  expect(originalError).toBe(opaque);
  expect(calls).toBe(2);
});

test('cleanup order, retry after failure and idempotent completion match Original', () => {
  const actualCalls: string[] = [];
  const originalCalls: string[] = [];
  let actualThrow = true;
  let originalThrow = true;
  const actual = Actual.mergeRegister(
    () => actualCalls.push('first'),
    () => {
      actualCalls.push('last');
      if (actualThrow) throw 'retry';
    }
  );
  const original = Original.mergeRegister(
    () => originalCalls.push('first'),
    () => {
      originalCalls.push('last');
      if (originalThrow) throw 'retry';
    }
  );
  expect(actual).toThrow('retry');
  expect(original).toThrow('retry');
  actualThrow = false;
  originalThrow = false;
  actual();
  original();
  actual();
  original();
  expect(actualCalls).toEqual(originalCalls);
  expect(actualCalls).toEqual(['last', 'last', 'first']);
});

test('text direction, format alignment and shortcut modifiers retain Original scalar behavior', () => {
  for (const text of [
    '',
    '0123',
    'abc',
    'אבג',
    'العربية',
    '123 אבג',
    '123 abc',
  ]) {
    expect(Actual.getTextDirection(text)).toBe(Original.getTextDirection(text));
  }
  for (const format of [0, 1, 32, 64, 256, 512, 1024, 2047]) {
    for (const type of [
      'bold',
      'subscript',
      'superscript',
      'lowercase',
      'uppercase',
      'capitalize',
    ] satisfies Original.TextFormatType[]) {
      for (const align of [null, 0, 2047]) {
        expect(Actual.toggleTextFormatType(format, type, align)).toBe(
          Original.toggleTextFormatType(format, type, align)
        );
      }
    }
  }
  const event = new KeyboardEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
  });
  for (const mask of [
    { ctrlKey: true },
    { ctrlKey: 'any' },
    { metaKey: true },
  ] satisfies Parameters<typeof Original.isModifierMatch>[1][]) {
    expect(Actual.isModifierMatch(event, mask)).toBe(
      Original.isModifierMatch(event, mask)
    );
    expect(Actual.isExactShortcutMatch(event, 'A', mask)).toBe(
      Original.isExactShortcutMatch(event, 'A', mask)
    );
  }
});
