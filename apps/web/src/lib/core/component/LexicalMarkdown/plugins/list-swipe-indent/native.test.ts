import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test } from 'vitest';
import { registerNativeListSwipeIndent } from './native';

beforeAll(initializeNativeSurfaceTests);

function pointer(target: EventTarget, type: string, x: number, y = 50) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
    pointerId: { value: 1 },
  });
  target.dispatchEvent(event);
}

function fixture() {
  const surface = nativeSurface();
  surface.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'task-list',
            version: 1,
            listType: 'check',
            start: 1,
            tag: 'ul',
            children: [
              {
                type: 'listitem',
                version: 1,
                value: 1,
                checked: true,
                children: [{ type: 'text', version: 1, text: 'Complete row' }],
              },
              {
                type: 'listitem',
                version: 1,
                value: 2,
                checked: false,
                children: [{ type: 'text', version: 1, text: 'Open row' }],
              },
            ],
          },
        ],
      },
    })
  );
  return surface;
}

test('registered touch swipe indents and outdents through the actual native action', async () => {
  const surface = fixture();
  const dispose = registerNativeListSwipeIndent(surface.view, () => true);
  try {
    const row = surface.root.querySelectorAll('li')[1];
    pointer(row, 'pointerdown', 50);
    pointer(document, 'pointermove', 110);
    pointer(document, 'pointerup', 110);
    await Promise.resolve();
    expect(surface.root.querySelector('li ul li')?.textContent).toBe(
      'Open row'
    );
    const nested = surface.root.querySelector('li ul li');
    if (!nested) throw new Error('Missing actual nested row');
    pointer(nested, 'pointerdown', 110);
    pointer(document, 'pointermove', 50);
    pointer(document, 'pointerup', 50);
    await Promise.resolve();
    expect(surface.root.querySelector('li ul')).toBeNull();
    expect(
      [...surface.root.querySelectorAll('li')].map((row) => row.textContent)
    ).toEqual(['Complete row', 'Open row']);
  } finally {
    dispose();
    surface.close();
  }
});

test.each([
  'vertical',
  'cancel',
  'permission',
  'dispose',
  'queued-dispose',
  'queued-permission',
] as const)(
  '%s stops an registered swipe before native mutation',
  async (reason) => {
    const surface = fixture();
    let canEdit = true;
    const dispose = registerNativeListSwipeIndent(surface.view, () => canEdit);
    try {
      const before = surface.session.serializedState();
      pointer(surface.root.querySelectorAll('li')[1], 'pointerdown', 50);
      pointer(document, 'pointermove', 110, reason === 'vertical' ? 130 : 50);
      if (reason === 'cancel') pointer(document, 'pointercancel', 110);
      if (reason === 'permission') canEdit = false;
      if (reason === 'dispose') dispose();
      pointer(document, 'pointerup', 110);
      if (reason === 'queued-dispose') dispose();
      if (reason === 'queued-permission') canEdit = false;
      await Promise.resolve();
      expect(surface.session.serializedState()).toBe(before);
    } finally {
      dispose();
      surface.close();
    }
  }
);

test('a real session downgrade during a swipe refuses mutation despite editable UI', async () => {
  const surface = fixture();
  const dispose = registerNativeListSwipeIndent(surface.view, () => true);
  try {
    pointer(surface.root.querySelectorAll('li')[1], 'pointerdown', 50);
    pointer(document, 'pointermove', 110);
    const flags = surface.session.authorization(true, false, false, 3, 3);
    if (flags & (1 | 2 | 8 | 16)) {
      const output = decodeOutput(surface.session.takeOutput());
      surface.view.apply(output.view, output.strings, output.viewEffects);
    }
    surface.view.setEditable(true);
    const before = surface.session.serializedState();
    pointer(document, 'pointerup', 110);
    await Promise.resolve();
    expect(surface.session.effectiveAccess()).toBe(Access.Read);
    expect(surface.session.serializedState()).toBe(before);
    expect(surface.root.querySelector('li ul')).toBeNull();
  } finally {
    dispose();
    surface.close();
  }
});
