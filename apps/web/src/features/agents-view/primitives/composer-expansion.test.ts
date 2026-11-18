import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

import { createComposerExpansion } from './composer-expansion';

describe('createComposerExpansion', () => {
  beforeEach(() => {
    device.touch = true;
  });
  it('collapses before focus and after blur without losing its focus history', () => {
    createRoot((dispose) => {
      const state = createComposerExpansion(
        () => true,
        () => false
      );
      expect(state.collapsed()).toBe(true);
      expect(state.hasFocused()).toBe(false);
      state.focus();
      expect(state.collapsed()).toBe(false);
      expect(state.hasFocused()).toBe(true);
      state.blur();
      expect(state.collapsed()).toBe(true);
      expect(state.hasFocused()).toBe(true);
      dispose();
    });
  });
  it('stays expanded while a control sheet is open', () => {
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(false);
      const state = createComposerExpansion(() => true, open);
      state.focus();
      setOpen(true);
      state.blur();
      expect(state.collapsed()).toBe(false);
      setOpen(false);
      expect(state.collapsed()).toBe(true);
      dispose();
    });
  });
  it('does not collapse desktop or noncompact composers', () => {
    createRoot((dispose) => {
      const state = createComposerExpansion(
        () => true,
        () => false
      );
      device.touch = false;
      expect(state.collapsed()).toBe(false);
      device.touch = true;
      expect(
        createComposerExpansion(
          () => false,
          () => false
        ).collapsed()
      ).toBe(false);
      dispose();
    });
  });
});
