import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createPopupCellKeys, isComposingKey } from './popup-cell-keys';

describe('popup cell keys', () => {
  it('opens on Enter, Space and F2 before other listeners, but not with a modifier', () => {
    const edit = vi.fn();
    const later = vi.fn();
    const trigger = document.createElement('button');
    trigger.addEventListener('keydown', later);
    const dispose = createRoot((dispose) => {
      createPopupCellKeys({ edit, close: vi.fn() }).triggerRef(trigger);
      return dispose;
    });
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    trigger.dispatchEvent(enter);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }));
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })
    );
    expect(enter.defaultPrevented).toBe(true);
    expect(edit).toHaveBeenCalledTimes(3);
    expect(later).toHaveBeenCalledTimes(1);
    dispose();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(edit).toHaveBeenCalledTimes(3);
  });

  it('moves Tab on the trigger through the grid, and leaves it alone without a grid', () => {
    const onNavigate = vi.fn(() => true);
    const withGrid = createRoot(() =>
      createPopupCellKeys({ onNavigate, edit: vi.fn(), close: vi.fn() })
    );
    const withoutGrid = createRoot(() =>
      createPopupCellKeys({ edit: vi.fn(), close: vi.fn() })
    );
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
    });
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(withGrid.tabFromTrigger(shiftTab)).toBe(true);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(-1);
    expect(withoutGrid.tabFromTrigger(tab)).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('moves on only after the popup it left with Tab has closed', async () => {
    const onNavigate = vi.fn(() => true);
    const close = vi.fn();
    const keys = createRoot(() =>
      createPopupCellKeys({ onNavigate, edit: vi.fn(), close })
    );
    keys.leave(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    const closed = new Event('focusout', { cancelable: true });
    keys.onCloseAutoFocus(closed);
    expect(closed.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
    const closedByEscape = new Event('focusout', { cancelable: true });
    keys.onCloseAutoFocus(closedByEscape);
    expect(closedByEscape.defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('treats IME composition as composing', () => {
    expect(
      isComposingKey(
        new KeyboardEvent('keydown', { key: 'a', isComposing: true })
      )
    ).toBe(true);
    expect(isComposingKey(new KeyboardEvent('keydown', { key: 'a' }))).toBe(
      false
    );
  });
});
