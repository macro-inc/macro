/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import type { ViewNode } from '../types';

beforeAll(initializeNativeSurfaceTests);

function topLevel(type: string, props: object): ViewNode {
  return {
    key: 2,
    type,
    typeIndex: 0,
    kind: 'element',
    parent: 0,
    children: [],
    text: '',
    propsJSON: JSON.stringify(props),
    stateJSON: '',
    props: () => JSON.parse(JSON.stringify(props)),
  };
}

test('Macro element views take the reconciler direction below the root like Source', () => {
  const fixture = nativeSurface();
  try {
    for (const [type, props] of [
      ['classed-block', { tag: 'div', classes: ['probe'] }],
      ['diff', { userId: 'user', label: 'AI Suggestion' }],
    ] as const) {
      const renderer = fixture.view.registry.get(type);
      const node = topLevel(type, props);
      const dom = renderer.createDOM(node, fixture.view.context);
      expect(dom.getAttribute('dir')).toBe('auto');
      dom.removeAttribute('dir');
      expect(renderer.updateDOM(node, node, dom, fixture.view.context)).toBe(
        false
      );
      expect(dom.getAttribute('dir')).toBe('auto');
    }
  } finally {
    fixture.close();
  }
});
