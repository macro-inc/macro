import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareDrawer } from './ShareDrawer';

vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ShareDrawer', () => {
  it('closes on a backdrop tap without clicking the row beneath it', async () => {
    const [open, setOpen] = createSignal(true);
    const openRow = vi.fn();
    render(() => (
      <>
        <button type="button" onClick={openRow}>
          Smoke note B
        </button>
        <Show when={open()}>
          <ShareDrawer open onOpenChange={setOpen}>
            <input aria-label="To" />
          </ShareDrawer>
        </Show>
      </>
    ));
    await screen.findByRole('dialog', { name: 'Share' });
    const row = screen.getByRole('button', { name: 'Smoke note B' });

    fireEvent.pointerDown(
      document.querySelector('[data-corvu-drawer-overlay]')!,
      {
        pointerType: 'touch',
        button: 0,
      }
    );
    expect(open()).toBe(false);
    fireEvent.pointerUp(row, { pointerType: 'touch', button: 0 });
    fireEvent.click(row);
    expect(openRow).not.toHaveBeenCalled();

    fireEvent.pointerDown(row, { pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(row, { pointerType: 'touch', button: 0 });
    fireEvent.click(row);
    expect(openRow).toHaveBeenCalledOnce();
  });
});
