/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import { registerMacroDecoratorViews } from './macro';

beforeAll(initializeNativeSurfaceTests);

test('native document cards create the Source block wrapper before attributes', () => {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      'document-card': () => document.createTextNode('rendered card'),
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'document-card',
              version: 1,
              documentId: 'fixture-document',
              documentName: 'Fixture Document',
              blockName: 'md',
              blockParams: {},
              previewBox: ['100%', '400px'],
            },
          ],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (record) => record.type === 'document-card'
    );
    if (!node) throw new Error('Missing actual native document card');
    const element = fixture.view.getElementByKey(node.key);
    if (!element) throw new Error('Missing mounted document card');
    expect(element.style.display).toBe('block');
    // jsdom does not reflect contentEditable into an HTML attribute.
    expect(element.contentEditable).toBe('false');
    // jsdom inserts the style attribute when createDOM sets display.
    expect(element.getAttributeNames()).toEqual([
      'style',
      'data-document-card',
      'data-lexical-decorator',
      'class',
    ]);
    expect(element.textContent).toBe('rendered card');
  } finally {
    fixture.close();
  }
});
