/** @vitest-environment jsdom */

import { ImageNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { MarkdownImageProps } from '../component/decorator/MarkdownImage';
import { createNativeMediaUploadEvents } from '../plugins/media/native-upload-events';
import { theme } from '../theme';
import { createNativeImageContext } from './native-image-host';
import { createNativeImageDecoratorViews } from './native-image-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/** Mounts stored images before a sibling paragraph and records what the component received. */
function mount(images: readonly object[]) {
  const received: MarkdownImageProps[] = [];
  setDecorator<MarkdownImageProps>(ImageNode, (props) => {
    received.push(props);
    return <span data-recorded-image="true" />;
  });
  const fixture = nativeSurface();
  const uploads = createNativeMediaUploadEvents();
  const context = createNativeImageContext(theme, () => true, uploads);
  const close = () => {
    context.dispose();
    uploads.dispose();
    fixture.close();
  };
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeImageDecoratorViews(context)
    );
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            ...images.map((image) => ({
              type: 'image',
              version: 1,
              ...image,
            })),
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
  } catch (error) {
    close();
    throw error;
  }
  return { fixture, received, close };
}

test('stored image fields Source keeps as null or missing reach the component unchanged', () => {
  const mounted = mount([
    {
      srcType: 'url',
      id: 'valid',
      url: 'https://example.com/valid.png',
      alt: 'Valid',
      width: 40,
      height: 30,
      scale: 1,
    },
    {
      srcType: 'url',
      id: null,
      url: 'https://example.com/null-dimensions.png',
      alt: 'Null dimensions',
      width: null,
      height: null,
      scale: 1,
      constrainedWidth: null,
      constrainedHeight: null,
    },
    {
      srcType: 'url',
      url: 'https://example.com/missing.png',
      alt: 'Missing fields',
      scale: 1,
    },
    {
      srcType: null,
      id: 'null-source',
      url: '',
      alt: 'Null source',
      width: 0,
      height: 0,
      scale: 1,
    },
    { url: 'missing-source', alt: 'Missing source', scale: 1 },
  ]);
  try {
    expect(
      mounted.received.map(
        ({
          srcType,
          id,
          url,
          width,
          height,
          constrainedWidth,
          constrainedHeight,
        }) => ({
          srcType,
          id,
          url,
          width,
          height,
          constrainedWidth,
          constrainedHeight,
        })
      )
    ).toEqual([
      {
        srcType: 'url',
        id: 'valid',
        url: 'https://example.com/valid.png',
        width: 40,
        height: 30,
        constrainedWidth: undefined,
        constrainedHeight: undefined,
      },
      {
        srcType: 'url',
        id: null,
        url: 'https://example.com/null-dimensions.png',
        width: null,
        height: null,
        constrainedWidth: null,
        constrainedHeight: null,
      },
      {
        srcType: 'url',
        id: undefined,
        url: 'https://example.com/missing.png',
        width: undefined,
        height: undefined,
        constrainedWidth: undefined,
        constrainedHeight: undefined,
      },
      {
        srcType: null,
        id: 'null-source',
        url: '',
        width: 0,
        height: 0,
        constrainedWidth: undefined,
        constrainedHeight: undefined,
      },
      {
        srcType: undefined,
        id: undefined,
        url: 'missing-source',
        width: undefined,
        height: undefined,
        constrainedWidth: undefined,
        constrainedHeight: undefined,
      },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-image]')
    ).toHaveLength(5);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('the stored model applies Source import defaults to alt and scale', () => {
  const mounted = mount([
    { srcType: 'url', url: 'https://example.com/a.png', alt: null, scale: 0 },
    { srcType: 'url', url: 'https://example.com/b.png', scale: null },
  ]);
  try {
    expect(mounted.received.map(({ alt, scale }) => ({ alt, scale }))).toEqual([
      { alt: '', scale: 1 },
      { alt: '', scale: 1 },
    ]);
  } finally {
    mounted.close();
  }
});

// Retained boundary: the component reads the url as text, so a null or missing
// one is refused here. This is not evidence of what Source does with it.
test('an image without a text url is refused at the projector boundary', () => {
  for (const image of [
    { srcType: 'url', url: null, alt: 'Null url', scale: 1 },
    { srcType: 'local', alt: 'Missing url', scale: 1 },
  ]) {
    expect(() => mount([image]).close()).toThrow(
      'Invalid native image decorator payload'
    );
  }
});

test('wrong value types are refused by the stored model before any projection', () => {
  for (const image of [
    { srcType: 'url', url: 'u', width: 'wide', scale: 1 },
    { srcType: 5, url: 'u', scale: 1 },
  ]) {
    expect(() => mount([image]).close()).toThrow('JSON error: invalid type');
  }
});
