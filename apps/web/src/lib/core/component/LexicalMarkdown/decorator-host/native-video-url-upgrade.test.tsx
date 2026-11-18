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
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { MarkdownVideoProps } from '../component/decorator/MarkdownVideo';
import { createNativeMediaUploadEvents } from '../plugins/media/native-upload-events';
import { theme } from '../theme';
import {
  createNativeVideoContext,
  createNativeVideoDecoratorViews,
} from './native-video-views';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('../plugins/group-b/command', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchApplicationCommandIfSessionEdit: mocks.dispatch,
}));

beforeAll(initializeNativeSurfaceTests);
afterEach(() => {
  clearDecorators();
  mocks.dispatch.mockReset();
});

/** The upgrade command native sends once a stored dss video resolves. */
function upgrade(video: object) {
  mocks.dispatch.mockReset();
  const received: MarkdownVideoProps[] = [];
  setDecorator<MarkdownVideoProps>(VideoNode, (props) => {
    received.push(props);
    return null;
  });
  const fixture = nativeSurface();
  const uploads = createNativeMediaUploadEvents();
  const context = createNativeVideoContext(theme, () => true, uploads);
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
          children: [{ type: 'video', version: 1, ...video }],
        },
      })
    );
    const props = received.at(-1);
    if (!props?.host) throw new Error('Missing projected video host');
    props.host.video.upgradeUrl(props.key, 'blob:fresh');
    return mocks.dispatch.mock.calls
      .filter(([, command]) => command === 'group-b.media-upgrade-url')
      .map(([, , payload]) => payload);
  } finally {
    context.dispose();
    uploads.dispose();
    fixture.close();
  }
}

// Source $upgradeDSSMediaUrl sets the resolved url whatever the stored url
// was, so a stored null or omitted url is replaced too. The native command
// carries the captured url, null or omitted, as its compare-and-set guard.
test('a resolved dss video replaces a stored null, missing or text url', () => {
  const dss = { srcType: 'dss', id: 'd', scale: 1 };
  expect(upgrade({ ...dss, url: 'blob:old' })).toStrictEqual([
    expect.objectContaining({
      kind: 'video',
      source_id: 'd',
      expected_url: 'blob:old',
      url: 'blob:fresh',
    }),
  ]);
  const [stored] = upgrade({ ...dss, url: null });
  expect(stored).toMatchObject({
    kind: 'video',
    source_id: 'd',
    expected_url: null,
    url: 'blob:fresh',
  });
  const [omitted] = upgrade(dss);
  expect(omitted).toMatchObject({
    kind: 'video',
    source_id: 'd',
    url: 'blob:fresh',
  });
  expect(Object.hasOwn(Object(omitted), 'expected_url')).toBe(false);
});
