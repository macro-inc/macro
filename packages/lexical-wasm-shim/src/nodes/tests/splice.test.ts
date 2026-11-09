import { expect, test } from 'vitest';
import { ConformanceBackend } from '../../backend/conformance';
import { nativeNode, TextNode } from '../index';
import { NodeRuntime, withNodeRuntime } from '../runtime';

test('text splice preserves JavaScript slice offsets and deletion counts', () => {
  const backend = new ConformanceBackend({ namespace: 'text splice' });
  const runtime = new NodeRuntime(backend, nativeNode);
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      expect(
        new TextNode('abcd').spliceText(-1, 1, 'XYZ').getTextContent()
      ).toBe('abXYZd');
      expect(new TextNode('abcd').spliceText(2, -1, 'Q').getTextContent()).toBe(
        'abQbcd'
      );
      expect(
        new TextNode('abcd').spliceText(1.7, 1.1, 'X').getTextContent()
      ).toBe('aXcd');
      expect(
        new TextNode('abcd').spliceText(Number.NaN, 1, 'X').getTextContent()
      ).toBe('Xabcd');
      expect(
        new TextNode('abcd')
          .spliceText(Number.POSITIVE_INFINITY, 1, 'X')
          .getTextContent()
      ).toBe('abcdX');
      backend.discard();
    });
  } finally {
    backend.dispose();
  }
});
