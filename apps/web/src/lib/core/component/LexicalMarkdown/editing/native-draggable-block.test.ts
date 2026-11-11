import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { Telemetry } from '@macro-inc/observability';
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { registerNativeDraggableBlock } from '../plugins/draggable-block/native';
import { installNativeMarkdownOverlays } from './installNativeMarkdownOverlays';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.restoreAllMocks());

test.each([undefined, null, { fault: 'drop listener' }])(
  'partial drag setup releases listeners and preserves opaque cause %s',
  (cause) => {
    const fixture = nativeSurface();
    const add = fixture.root.addEventListener.bind(fixture.root);
    vi.spyOn(fixture.root, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'drop') throw cause;
        add(type, listener, options);
      }
    );
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const rootRemove = vi.spyOn(fixture.root, 'removeEventListener');
    let failure: { value: unknown } | undefined;
    try {
      registerNativeDraggableBlock(fixture.view, () => {});
    } catch (error) {
      failure = { value: error };
    }
    try {
      expect(failure).toEqual({ value: cause });
      expect(
        documentRemove.mock.calls.filter(([type]) => type === 'mousemove')
      ).toHaveLength(1);
      expect(
        rootRemove.mock.calls.filter(([type]) => type === 'keydown')
      ).toHaveLength(1);
      expect(
        rootRemove.mock.calls.filter(([type]) => type === 'dragover')
      ).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      fixture.close();
    }
  }
);

test('disposing a drag registration releases its listeners exactly once', () => {
  const fixture = nativeSurface();
  const registration = registerNativeDraggableBlock(fixture.view, () => {});
  const documentRemove = vi.spyOn(document, 'removeEventListener');
  const rootRemove = vi.spyOn(fixture.root, 'removeEventListener');
  try {
    registration.dispose();
    registration.dispose();
    expect(
      documentRemove.mock.calls.filter(([type]) => type === 'mousemove')
    ).toHaveLength(1);
    expect(
      rootRemove.mock.calls.filter(([type]) => type === 'drop')
    ).toHaveLength(1);
  } finally {
    vi.restoreAllMocks();
    fixture.close();
  }
});

test.each([undefined, null, { fault: 'drag mount' }])(
  'a failed optional drag UI retires its partial listeners and leaves the view usable %s',
  (cause) => {
    const fixture = nativeSurface();
    const installation = installNativeMarkdownOverlays(fixture.view, {
      canEdit: () => true,
    });
    const add = fixture.root.addEventListener.bind(fixture.root);
    vi.spyOn(fixture.root, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'drop') throw cause;
        add(type, listener, options);
      }
    );
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const error = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.append(container);
    const unmount = render(
      () => installation.Overlays && createComponent(installation.Overlays, {}),
      container
    );
    try {
      expect(error).toHaveBeenCalled();
      const registered = documentAdd.mock.calls
        .filter(([type]) => type === 'mousemove')
        .map(([, listener]) => listener);
      expect(registered.length).toBeGreaterThan(0);
      for (const listener of registered) {
        expect(
          remove.mock.calls.filter(
            ([type, removed]) => type === 'mousemove' && removed === listener
          )
        ).toHaveLength(1);
      }
      expect(document.querySelector('.draggable-block-menu')).toBeNull();
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [
                  { type: 'text', version: 1, text: 'Still editable' },
                ],
              },
            ],
          },
        })
      );
      expect(fixture.root.textContent).toBe('Still editable');
      expect(fixture.view.isMounted).toBe(true);
      unmount();
      installation.dispose();
      installation.dispose();
      for (const listener of registered) {
        expect(
          remove.mock.calls.filter(
            ([type, removed]) => type === 'mousemove' && removed === listener
          )
        ).toHaveLength(1);
      }
    } finally {
      unmount();
      installation.dispose();
      container.remove();
      vi.restoreAllMocks();
      fixture.close();
    }
  }
);

test('drag UI remount owns exactly one fresh listener registration', () => {
  const fixture = nativeSurface();
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const container = document.createElement('div');
  document.body.append(container);
  try {
    for (let mount = 0; mount < 2; mount++) {
      const installation = installNativeMarkdownOverlays(fixture.view, {
        canEdit: () => true,
      });
      const unmount = render(
        () =>
          installation.Overlays && createComponent(installation.Overlays, {}),
        container
      );
      expect(document.querySelectorAll('.draggable-block-menu')).toHaveLength(
        1
      );
      expect(
        add.mock.calls.filter(([type]) => type === 'mousemove')
      ).toHaveLength(mount + 1);
      installation.dispose();
      unmount();
      installation.dispose();
      expect(document.querySelector('.draggable-block-menu')).toBeNull();
      expect(
        remove.mock.calls.filter(([type]) => type === 'mousemove')
      ).toHaveLength(mount + 1);
    }
  } finally {
    container.remove();
    vi.restoreAllMocks();
    fixture.close();
  }
});
