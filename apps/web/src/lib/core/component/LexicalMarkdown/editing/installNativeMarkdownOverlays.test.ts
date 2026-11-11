import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import blockGap from './browser-test/fixtures/block-gap.json';
import tableSelection from './browser-test/fixtures/table-selection.json';
import { installNativeMarkdownOverlays } from './installNativeMarkdownOverlays';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.restoreAllMocks());

test('live host permission gates gap input even while native access and the DOM remain editable', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(blockGap));
  const previous = fixture.root.children[0];
  const next = fixture.root.children[1];
  vi.spyOn(previous, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 20)
  );
  vi.spyOn(next, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 40, 100, 20)
  );
  let canEdit = false;
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => canEdit,
  });
  const before = fixture.session.serializedState();
  try {
    fixture.root.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 30 })
    );
    expect(fixture.session.serializedState()).toBe(before);
    canEdit = true;
    fixture.root.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 30 })
    );
    expect(fixture.session.serializedState()).not.toBe(before);
    expect(fixture.root.children).toHaveLength(4);
  } finally {
    installation.dispose();
    fixture.close();
  }
});

test('a partial long-press registration clears its actual timer and document listeners', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(tableSelection));
  const addedRoot: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject;
  }> = [];
  const rootAdd = fixture.root.addEventListener.bind(fixture.root);
  vi.spyOn(fixture.root, 'addEventListener').mockImplementation(
    (type, listener, options) => {
      addedRoot.push({ type, listener });
      rootAdd(type, listener, options);
    }
  );
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  const added: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject;
  }> = [];
  const add = document.addEventListener.bind(document);
  const removed = vi.spyOn(document, 'removeEventListener');
  const clear = vi.spyOn(window, 'clearTimeout');
  const cause = { reason: 'gesture document listener rejected' };
  vi.spyOn(document, 'addEventListener').mockImplementation(
    (type, listener, options) => {
      if (type === 'touchmove') throw cause;
      added.push({ type, listener });
      add(type, listener, options);
    }
  );
  const event = new MouseEvent('pointerdown', { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
    pointerId: { value: 1 },
    target: { value: fixture.root.querySelector('td') },
  });
  const down = addedRoot.findLast(
    ({ type }) => type === 'pointerdown'
  )?.listener;
  let failure: { error: unknown } | undefined;
  try {
    if (typeof down !== 'function')
      throw new Error('Missing actual touch listener');
    try {
      down.call(fixture.root, event);
    } catch (error) {
      failure = { error };
    }
    expect(failure?.error).toBe(cause);
    expect(clear).toHaveBeenCalledTimes(1);
    for (const { type, listener } of added)
      expect(removed).toHaveBeenCalledWith(type, listener);
  } finally {
    installation.dispose();
    fixture.close();
  }
});

for (const cause of [undefined, null, { reason: 'opaque listener failure' }]) {
  test('partial overlay installation releases real listeners and preserves the opaque cause', () => {
    const fixture = nativeSurface();
    const added: Array<{
      type: string;
      listener: EventListenerOrEventListenerObject;
    }> = [];
    const add = fixture.root.addEventListener.bind(fixture.root);
    const removed = vi.spyOn(fixture.root, 'removeEventListener');
    vi.spyOn(fixture.root, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'contextmenu') throw cause;
        added.push({ type, listener });
        add(type, listener, options);
      }
    );
    let failure: { error: unknown } | undefined;
    try {
      installNativeMarkdownOverlays(fixture.view, { canEdit: () => true });
    } catch (error) {
      failure = { error };
    }
    try {
      expect(failure).toBeDefined();
      expect(failure?.error).toBe(cause);
      expect(added.length).toBeGreaterThan(0);
      for (const { type, listener } of added) {
        expect(removed).toHaveBeenCalledWith(type, listener);
      }
    } finally {
      fixture.close();
    }
  });

  test('overlay disposal releases every real listener once despite an opaque cleanup failure', () => {
    const fixture = nativeSurface();
    const added: Array<{
      type: string;
      listener: EventListenerOrEventListenerObject;
    }> = [];
    const add = fixture.root.addEventListener.bind(fixture.root);
    vi.spyOn(fixture.root, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        added.push({ type, listener });
        add(type, listener, options);
      }
    );
    const installation = installNativeMarkdownOverlays(fixture.view, {
      canEdit: () => true,
    });
    const remove = fixture.root.removeEventListener.bind(fixture.root);
    const removed = vi
      .spyOn(fixture.root, 'removeEventListener')
      .mockImplementation((type, listener, options) => {
        remove(type, listener, options);
        if (type === 'contextmenu') throw cause;
      });
    let failure: { error: unknown } | undefined;
    try {
      installation.dispose();
    } catch (error) {
      failure = { error };
    }
    try {
      expect(failure).toBeDefined();
      expect(failure?.error).toBe(cause);
      for (const { type, listener } of added) {
        expect(
          removed.mock.calls.filter(
            ([name, callback]) => name === type && callback === listener
          )
        ).toHaveLength(1);
      }
      const count = removed.mock.calls.length;
      installation.dispose();
      expect(removed).toHaveBeenCalledTimes(count);
    } finally {
      removed.mockRestore();
      fixture.close();
    }
  });
}

const STATE = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'list',
        version: 1,
        listType: 'check',
        tag: 'ul',
        start: 1,
        children: [
          {
            type: 'listitem',
            version: 1,
            checked: false,
            value: 1,
            children: [{ type: 'text', version: 1, text: 'Check this row' }],
          },
        ],
      },
    ],
  },
});

test('installed pointer bridge toggles the real native checklist and stops after disposal', () => {
  const fixture = nativeSurface();
  fixture.port.setState(STATE);
  const item = fixture.root.querySelector<HTMLElement>('[role="checkbox"]');
  if (!item) throw new Error('Missing native checkbox');
  const originalFont = document.documentElement.style.fontSize;
  document.documentElement.style.fontSize = '16px';
  vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 200, 20)
  );
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  const before = fixture.session.serializedState();
  try {
    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(item.hasAttribute('tabindex')).toBe(false);
    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 90,
      clientY: 108,
    });
    item.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    item.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 90, clientY: 108 })
    );
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(fixture.session.serializedState()).not.toBe(before);
    const checked = fixture.session.serializedState();
    installation.dispose();
    installation.dispose();
    item.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 90, clientY: 108 })
    );
    expect(fixture.session.serializedState()).toBe(checked);

    const remounted = installNativeMarkdownOverlays(fixture.view, {
      canEdit: () => true,
    });
    try {
      item.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          clientX: 90,
          clientY: 108,
        })
      );
      item.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 90, clientY: 108 })
      );
      expect(item.getAttribute('aria-checked')).toBe('false');
      expect(fixture.session.serializedState()).toBe(before);
    } finally {
      remounted.dispose();
    }
  } finally {
    installation.dispose();
    document.documentElement.style.fontSize = originalFont;
    fixture.close();
  }
});

test('UI editability cannot authorize native checklist writes in a read-only session', () => {
  const fixture = nativeSurface();
  fixture.port.setState(STATE);
  const flags = fixture.session.authorization(true, false, false, 2, 2);
  if (flags & (1 | 2 | 8 | 16)) {
    const revoked = decodeOutput(fixture.session.takeOutput());
    fixture.view.apply(revoked.view, revoked.strings, revoked.viewEffects);
  }
  fixture.view.setEditable(true);
  const errors: unknown[] = [];
  vi.spyOn(fixture.view.options, 'onError').mockImplementation((error) => {
    errors.push(error);
  });
  const item = fixture.root.querySelector<HTMLElement>('[role="checkbox"]');
  if (!item) throw new Error('Missing read-only native checkbox');
  const originalFont = document.documentElement.style.fontSize;
  document.documentElement.style.fontSize = '16px';
  vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 200, 20)
  );
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  try {
    const before = fixture.session.serializedState();
    item.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 90,
        clientY: 108,
      })
    );
    item.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 90, clientY: 108 })
    );
    expect(fixture.session.effectiveAccess()).toBe(Access.Read);
    expect(fixture.session.serializedState()).toBe(before);
    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(errors).toEqual([new Error('document is read-only')]);
  } finally {
    installation.dispose();
    document.documentElement.style.fontSize = originalFont;
    fixture.close();
  }
});
