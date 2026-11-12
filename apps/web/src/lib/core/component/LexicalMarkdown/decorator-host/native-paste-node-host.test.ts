/** @vitest-environment jsdom */

import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { createComputed, createRoot } from 'solid-js';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { theme } from '../theme';
import { createNativePasteNodeContext } from './native-paste-node-host';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.restoreAllMocks());

test('a reactive reader follows view editability through one subscription released on dispose', () => {
  const fixture = nativeSurface();
  const context = createNativePasteNodeContext(theme);
  const original = fixture.view.onEditableChange.bind(fixture.view);
  const releases: number[] = [];
  const subscribe = vi
    .spyOn(fixture.view, 'onEditableChange')
    .mockImplementation((listener) => {
      const release = original(listener);
      return () => {
        releases.push(1);
        return release();
      };
    });
  let stopObserver = () => {};
  try {
    fixture.view.setEditable(false);
    context.bindView(fixture.view);
    expect(subscribe).toHaveBeenCalledTimes(1);
    // A real observer, as PasteNode's <Show when={isEditable()}> is: no manual reads.
    const observed: boolean[] = [];
    createRoot((dispose) => {
      stopObserver = dispose;
      createComputed(() => observed.push(context.host.isEditable()));
    });
    expect(observed).toEqual([false]);
    fixture.view.setEditable(true);
    expect(observed).toEqual([false, true]);
    // Rebinding the same view keeps the single subscription.
    context.bindView(fixture.view);
    expect(subscribe).toHaveBeenCalledTimes(1);
    fixture.view.setEditable(false);
    fixture.view.setEditable(true);
    expect(observed).toEqual([false, true, false, true]);
    context.dispose();
    expect(releases).toHaveLength(1);
    expect(observed.at(-1)).toBe(false);
    const afterDispose = observed.length;
    // The released listener no longer drives the observer.
    fixture.view.setEditable(false);
    fixture.view.setEditable(true);
    expect(observed).toHaveLength(afterDispose);
  } finally {
    stopObserver();
    context.dispose();
    fixture.close();
  }
});
