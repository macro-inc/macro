/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import { registerMacroDecoratorViews } from './macro';

beforeAll(initializeNativeSurfaceTests);

test('native HTML decorators retain the block mount and jsdom attribute order', () => {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      'html-render': () => document.createTextNode('rendered HTML'),
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'html-render', version: 1, html: '<b>HTML</b>' }],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (record) => record.type === 'html-render'
    );
    if (!node) throw new Error('Missing actual native HTML decorator');
    const element = fixture.view.getElementByKey(node.key);
    if (!element) throw new Error('Missing mounted HTML decorator');
    expect(element.style.display).toBe('block');
    // jsdom does not reflect contentEditable into an HTML attribute.
    expect(element.contentEditable).toBe('false');
    // jsdom inserts the style attribute when createDOM sets display.
    expect(element.getAttributeNames()).toEqual([
      'style',
      'data-html-render',
      'data-lexical-decorator',
      'class',
    ]);
    expect(element.textContent).toBe('rendered HTML');
  } finally {
    fixture.close();
  }
});
