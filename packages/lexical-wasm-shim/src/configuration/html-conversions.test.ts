// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { TextNode } from '../nodes';
import type { DOMConversionFn, DOMConversionMap } from '../nodes/dom-types';
import {
  getHTMLElementConversionFunction,
  initializeConversionCache,
} from './html-conversions';
import { prepareEditorRegisteredNodes } from './registered-nodes';

test('cache deduplicates importer identity with its first actual class receiver and appends configured importers', () => {
  class First extends TextNode {
    $config() {
      return this.config('html-first', { extends: TextNode });
    }
  }
  class Second extends TextNode {
    $config() {
      return this.config('html-second', { extends: TextNode });
    }
  }
  const { registeredNodes } = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [First, Second],
  });
  const events: unknown[] = [];
  const first = () => null;
  const additional = () => null;
  const map: DOMConversionMap = {
    get span() {
      events.push('span');
      return first;
    },
    get div() {
      events.push('div');
      return first;
    },
  };
  function importer(this: typeof First): DOMConversionMap {
    events.push(this);
    return map;
  }
  Object.defineProperty(First, 'importDOM', {
    configurable: true,
    get() {
      events.push('first.importDOM');
      return importer;
    },
  });
  Object.defineProperty(Second, 'importDOM', {
    configurable: true,
    get() {
      events.push('second.importDOM');
      return importer;
    },
  });
  const cache = initializeConversionCache(registeredNodes, {
    span: additional,
  });
  expect(events).toEqual([
    'first.importDOM',
    First,
    'span',
    'div',
    'second.importDOM',
  ]);
  expect(cache.get('span')?.slice(-2)).toEqual([first, additional]);
  expect(cache.get('div')?.at(-1)).toBe(first);
});

test('selector preserves null candidates, highest priority, final ties and lazy conversion getters', () => {
  {
    const span = document.createElement('span');
    const events: unknown[] = [];
    const selected: DOMConversionFn = () => null;
    const result = getHTMLElementConversionFunction(
      span,
      new Map([
        [
          'span',
          [
            (node: HTMLElement) => {
              events.push(node);
              return null;
            },
            () => ({
              get conversion(): DOMConversionFn {
                throw new Error('losing conversion was read');
              },
              priority: 1,
            }),
            () => ({ conversion: () => null, priority: 4 }),
            () => ({
              get conversion() {
                events.push('chosen');
                return selected;
              },
              priority: 4,
            }),
            () => ({ conversion: () => null }),
          ],
        ],
      ])
    );
    expect(result).toBe(selected);
    expect(events).toEqual([span, 'chosen']);
    expect(getHTMLElementConversionFunction(span, new Map())).toBe(null);
  }
});

test('cache and selector propagate opaque user getter and callback errors', () => {
  class Custom extends TextNode {
    $config() {
      return this.config('html-errors', { extends: TextNode });
    }
  }
  const { registeredNodes } = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [Custom],
  });
  const failure = { reason: 'import hook' };
  Object.defineProperty(Custom, 'importDOM', {
    get() {
      throw failure;
    },
  });
  expect(() => initializeConversionCache(registeredNodes)).toThrow(failure);
  {
    const paragraph = document.createElement('p');
    expect(() =>
      getHTMLElementConversionFunction(
        paragraph,
        new Map([
          [
            'p',
            [
              () => {
                throw failure;
              },
            ],
          ],
        ])
      )
    ).toThrow(failure);
  }
});
