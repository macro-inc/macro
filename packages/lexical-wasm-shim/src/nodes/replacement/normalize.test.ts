import { expect, test } from 'vitest';
import type { LexicalNode } from '../base';
import { ParagraphNode } from '../builtins';
import { TabNode } from '../tab';
import { TextNode } from '../text';
import { actualNodeClass } from './bind';
import { normalizeNodeConfig, normalizeNodeConfigs } from './normalize';

test('normalization samples replacement getters once in source order and retains explicit entries', () => {
  const reads: string[] = [];
  const config = {
    get replace() {
      reads.push('replace');
      return TextNode;
    },
    get with() {
      reads.push('with');
      return (node: LexicalNode) => node;
    },
    get withKlass() {
      reads.push('withKlass');
      return TabNode;
    },
  };
  const normalized = normalizeNodeConfigs([
    ParagraphNode,
    config,
    TextNode,
    TextNode,
  ]);
  expect(reads).toEqual(['replace', 'with', 'withKlass']);
  expect(normalized[0]).toBe(ParagraphNode);
  expect(normalized.slice(2)).toEqual([TextNode, TextNode]);
  const replacement = normalized[1];
  if (typeof replacement === 'function')
    throw new Error('expected replacement entry');
  expect(replacement.replace).toBe(TextNode);
  expect(replacement.withKlass).toBe(TabNode);
  expect(reads).toEqual(['replace', 'with', 'withKlass']);
});

test('class-like normalization retains the single validated constructor snapshot', () => {
  class Expected extends TextNode {}
  class Other extends TextNode {}
  let reads = 0;
  Object.defineProperty(Expected.prototype, 'constructor', {
    get: () => (++reads === 1 ? Expected : Other),
  });
  expect(normalizeNodeConfig(Expected)).toBe(Expected);
  expect(reads).toBe(1);
  expect(() => actualNodeClass(class Unrelated {})).toThrow(
    'must belong to this core'
  );
});
