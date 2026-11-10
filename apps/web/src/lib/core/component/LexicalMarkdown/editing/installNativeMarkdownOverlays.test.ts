import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { installNativeMarkdownOverlays } from './installNativeMarkdownOverlays';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.restoreAllMocks());

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
  const installation = installNativeMarkdownOverlays(fixture.view);
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

    const remounted = installNativeMarkdownOverlays(fixture.view);
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
  const installation = installNativeMarkdownOverlays(fixture.view);
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
