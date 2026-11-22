/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import type { ViewNode } from '../types';

beforeAll(initializeNativeSurfaceTests);

function element(type: string, props: object): ViewNode {
  return {
    key: 2,
    type,
    typeIndex: 0,
    kind: 'element',
    parent: null,
    children: [],
    text: '',
    propsJSON: JSON.stringify(props),
    stateJSON: '',
    props: () => JSON.parse(JSON.stringify(props)),
  };
}

test('autolinks use the Source LinkNode theme class on create and update', () => {
  const fixture = nativeSurface(undefined, { link: 'text-link underline' });
  try {
    const renderer = fixture.view.registry.get('autolink');
    const first = element('autolink', { url: 'https://example.com' });
    const dom = renderer.createDOM(first, fixture.view.context);
    expect(dom.tagName).toBe('A');
    expect(dom.className).toBe('text-link underline');
    const next = element('autolink', { url: 'https://example.org' });
    expect(renderer.updateDOM(first, next, dom, fixture.view.context)).toBe(
      false
    );
    expect(dom.className).toBe('text-link underline');
    expect(dom.getAttribute('href')).toBe('https://example.org');
  } finally {
    fixture.close();
  }
});
