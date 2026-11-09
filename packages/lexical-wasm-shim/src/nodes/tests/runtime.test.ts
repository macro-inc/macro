import { expect, test } from 'vitest';
import { ConformanceBackend } from '../../backend/conformance';
import {
  assumeNodeType,
  createPointWithUpstreamType,
  nodeConfigRecord,
} from '../../compatibility-exceptions';
import {
  LexicalNode,
  nativeNode,
  ParagraphNode,
  RootNode,
  TextNode,
} from '../index';
import { NodeRuntime, nodeWriteField, withNodeRuntime } from '../runtime';

test('caller node assertion accepts only the exact live active capture', () => {
  const backend = new ConformanceBackend({ namespace: 'node assertion' });
  const runtime = new NodeRuntime(backend, nativeNode);
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      const text = new TextNode('before');
      const paragraph = new ParagraphNode().append(text);
      expect(() => nodeWriteField(paragraph, '__format', 99)).toThrow(
        'raw element-format write capability'
      );
      expect(paragraph.getFormat()).toBe(0);
      const root = runtime.call('lexical.$getRoot', []);
      if (!(root instanceof RootNode)) throw new Error('expected root');
      root.append(paragraph);
      expect(assumeNodeType<TextNode>(text)).toBe(text);
      const forged = Object.setPrototypeOf({}, TextNode.prototype);
      expect(() => Reflect.apply(assumeNodeType, undefined, [forged])).toThrow(
        'no model record'
      );
      expect(() => Reflect.apply(assumeNodeType, undefined, [{}])).toThrow(
        'expected a compat LexicalNode'
      );
      backend.commit();
      backend.beginUpdate([], false);
      const writable = text.getWritable();
      expect(writable).not.toBe(text);
      expect(() => assumeNodeType<TextNode>(text)).toThrow(
        'not the exact active model capture'
      );
      expect(assumeNodeType<TextNode>(writable)).toBe(writable);
      backend.readState('1', () =>
        expect(assumeNodeType<TextNode>(text)).toBe(text)
      );
      backend.discard();
    });
  } finally {
    backend.dispose();
  }
});

test('config exception preserves the exact single literal key and mutable value', () => {
  const config = { extends: TextNode, marker: 'before' };
  const result = nodeConfigRecord('__proto__', config);
  expect(Reflect.ownKeys(result)).toEqual(['__proto__']);
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe(
    config
  );
  config.marker = 'after';
  expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({
    extends: TextNode,
    marker: 'after',
  });
});

test('point exception preserves the pinned owner-less construction state', () => {
  const point = createPointWithUpstreamType('key', 2, 'text');
  expect(point.key).toBe('key');
  expect(point.offset).toBe(2);
  expect(point.type).toBe('text');
  expect(point._selection).toBeNull();
  expect(
    Number.isNaN(createPointWithUpstreamType('key', Number.NaN, 'text').offset)
  ).toBe(true);
});

test('base static type lookup reads the prototype configuration without constructing a node', () => {
  class ConfigOnlyNode extends TextNode {
    $config() {
      return this.config('config-only', { extends: TextNode });
    }
  }
  expect(Reflect.apply(LexicalNode.getType, ConfigOnlyNode, [])).toBe(
    'config-only'
  );
});
