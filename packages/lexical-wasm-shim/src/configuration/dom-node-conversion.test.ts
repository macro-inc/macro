// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { createEditor } from '../editor';
import { TextNode } from '../nodes';
import type { DOMConversionFn, DOMConversionProp } from '../nodes/dom-types';
import {
  getDOMNodeConversionFunction,
  initializeConversionCache,
} from './html-conversions';

test('cache factories and selected converters receive the exact real Text in source order', () => {
  const text = document.createTextNode('text');
  const events: unknown[] = [];
  const output = { node: null };
  const factories: DOMConversionProp<HTMLElement>[] = [
    (node) => {
      events.push('first', node);
      return {
        get conversion(): DOMConversionFn {
          throw new Error('losing converter read');
        },
        priority: 0,
      };
    },
    (node) => {
      events.push('last', node);
      return {
        get conversion() {
          events.push('get conversion');
          return (converted: HTMLElement) => {
            events.push('convert', converted);
            return output;
          };
        },
        priority: 0,
      };
    },
  ];
  const selected = getDOMNodeConversionFunction(
    text,
    new Map([['#text', factories]])
  );
  expect(events).toEqual(['first', text, 'last', text, 'get conversion']);
  if (selected === null) throw new Error('missing text converter');
  expect(selected(text)).toBe(output);
  expect(events).toEqual([
    'first',
    text,
    'last',
    text,
    'get conversion',
    'convert',
    text,
  ]);
});

test('Node cache preserves opaque factory, conversion getter and selected converter errors', () => {
  const text = document.createTextNode('text');
  const failure = { reason: 'Node conversion' };
  const factory: DOMConversionProp<HTMLElement> = (node) => {
    expect(node).toBe(text);
    throw failure;
  };
  expect(() =>
    getDOMNodeConversionFunction(text, new Map([['#text', [factory]]]))
  ).toThrow(failure);
  const getter: DOMConversionProp<HTMLElement> = () => ({
    get conversion(): DOMConversionFn {
      throw failure;
    },
  });
  expect(() =>
    getDOMNodeConversionFunction(text, new Map([['#text', [getter]]]))
  ).toThrow(failure);
  const converter: DOMConversionProp<HTMLElement> = () => ({
    conversion: (node) => {
      expect(node).toBe(text);
      throw failure;
    },
  });
  const selected = getDOMNodeConversionFunction(
    text,
    new Map([['#text', [converter]]])
  );
  if (selected === null) throw new Error('missing converter');
  expect(() => selected(text)).toThrow(failure);
  expect(getDOMNodeConversionFunction(text, new Map())).toBe(null);
});

test('actual builtin text import consumes real DOM Text under its registered editor', () => {
  const editor = createEditor();
  try {
    editor.update(
      () => {
        const paragraph = document.createElement('p');
        const text = document.createTextNode('  boundary\ntext  ');
        paragraph.appendChild(text);
        const convert = getDOMNodeConversionFunction(
          text,
          initializeConversionCache(editor._nodes)
        );
        if (convert === null) throw new Error('missing builtin text converter');
        const node = convert(text)?.node;
        expect(node).toBeInstanceOf(TextNode);
        if (!(node instanceof TextNode))
          throw new Error('expected actual builtin TextNode');
        expect(node.getTextContent()).toBe('boundary text');
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
