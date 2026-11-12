/** @vitest-environment jsdom */

import { VideoNode } from '@macro-inc/lexical-core';
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
import type { MarkdownVideoProps } from '../component/decorator/MarkdownVideo';
import { createNativeMediaUploadEvents } from '../plugins/media/native-upload-events';
import { theme } from '../theme';
import {
  createNativeVideoContext,
  createNativeVideoDecoratorViews,
} from './native-video-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/** Mounts stored videos before a sibling paragraph and records what the component received. */
function mount(videos: readonly object[]) {
  const received: MarkdownVideoProps[] = [];
  setDecorator<MarkdownVideoProps>(VideoNode, (props) => {
    received.push(props);
    return <span data-recorded-video="true" />;
  });
  const fixture = nativeSurface();
  const uploads = createNativeMediaUploadEvents();
  const context = createNativeVideoContext(theme, () => true, uploads);
  const close = () => {
    context.dispose();
    uploads.dispose();
    fixture.close();
  };
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeVideoDecoratorViews(context)
    );
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            ...videos.map((video) => ({
              type: 'video',
              version: 1,
              ...video,
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

test('stored video fields Source keeps as null or missing reach the component unchanged', () => {
  const mounted = mount([
    {
      srcType: 'url',
      id: 'valid',
      url: 'https://example.com/valid.mp4',
      controls: true,
      width: 40,
      height: 30,
      scale: 1,
    },
    {
      srcType: 'url',
      id: null,
      url: 'https://example.com/null-dimensions.mp4',
      width: null,
      height: null,
      scale: 1,
      constrainedWidth: null,
      constrainedHeight: null,
    },
    {
      srcType: 'url',
      url: 'https://example.com/missing.mp4',
      scale: 1,
    },
    {
      srcType: null,
      id: 'null-source',
      url: '',
      width: 0,
      height: 0,
      scale: 1,
    },
    { url: 'missing-source', scale: 1 },
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
        url: 'https://example.com/valid.mp4',
        width: 40,
        height: 30,
        constrainedWidth: undefined,
        constrainedHeight: undefined,
      },
      {
        srcType: 'url',
        id: null,
        url: 'https://example.com/null-dimensions.mp4',
        width: null,
        height: null,
        constrainedWidth: null,
        constrainedHeight: null,
      },
      {
        srcType: 'url',
        id: undefined,
        url: 'https://example.com/missing.mp4',
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
      mounted.fixture.root.querySelectorAll('[data-recorded-video]')
    ).toHaveLength(5);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('the stored model applies Source import defaults to controls and scale', () => {
  const mounted = mount([
    {
      srcType: 'url',
      url: 'https://example.com/a.mp4',
      controls: null,
      scale: 0,
    },
    { srcType: 'url', url: 'https://example.com/b.mp4', scale: null },
  ]);
  try {
    expect(
      mounted.received.map(({ controls, scale }) => ({ controls, scale }))
    ).toEqual([
      { controls: true, scale: 1 },
      { controls: true, scale: 1 },
    ]);
  } finally {
    mounted.close();
  }
});

// Source VideoNode.importJSON keeps a stored url as it is (MediaNode setUrl),
// and MarkdownVideo renders a null or omitted url as an unloaded video.
test('a stored null or missing video url reaches the component unchanged', () => {
  const mounted = mount([
    { srcType: 'url', url: null, scale: 1 },
    { srcType: 'dss', id: 'd', scale: 1 },
  ]);
  try {
    expect(
      mounted.received.map((props) => ({
        srcType: props.srcType,
        id: props.id,
        hasUrl: Object.hasOwn(props, 'url'),
        url: props.url,
      }))
    ).toStrictEqual([
      { srcType: 'url', id: undefined, hasUrl: true, url: null },
      { srcType: 'dss', id: 'd', hasUrl: true, url: undefined },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-video]')
    ).toHaveLength(2);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('wrong value types are refused by the stored model before any projection', () => {
  for (const video of [
    { srcType: 'url', url: 'u', width: 'wide', scale: 1 },
    { srcType: 'url', url: 'u', controls: 'yes', scale: 1 },
  ]) {
    expect(() => mount([video]).close()).toThrow('JSON error: invalid type');
  }
});
