/** @vitest-environment jsdom */

import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { createRoot } from 'solid-js';
import { beforeAll, expect, test } from 'vitest';
import { theme } from '../theme';
import { createNativePasteNodeContext } from './native-paste-node-host';

beforeAll(initializeNativeSurfaceTests);

test('the paste host follows view editability from bind until dispose', () => {
  const fixture = nativeSurface();
  const context = createNativePasteNodeContext(theme);
  try {
    expect(context.host.isEditable()).toBe(false);
    fixture.view.setEditable(false);
    context.bindView(fixture.view);
    expect(context.host.isEditable()).toBe(false);
    const seen: boolean[] = [];
    const dispose = createRoot((dispose) => {
      // A reactive reader, as PasteNode's <Show when={isEditable()}> is.
      const track = () => seen.push(context.host.isEditable());
      track();
      return () => {
        track();
        dispose();
      };
    });
    fixture.view.setEditable(true);
    expect(context.host.isEditable()).toBe(true);
    // Rebinding the same view must not subscribe twice.
    context.bindView(fixture.view);
    fixture.view.setEditable(false);
    expect(context.host.isEditable()).toBe(false);
    fixture.view.setEditable(true);
    expect(context.host.isEditable()).toBe(true);
    dispose();
    expect(seen[0]).toBe(false);
    context.dispose();
    expect(context.host.isEditable()).toBe(false);
    // After dispose the view's later editability no longer reaches the host.
    fixture.view.setEditable(true);
    expect(context.host.isEditable()).toBe(false);
  } finally {
    context.dispose();
    fixture.close();
  }
});
