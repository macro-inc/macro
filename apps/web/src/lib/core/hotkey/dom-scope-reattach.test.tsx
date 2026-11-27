import { Tooltip } from '@kobalte/core/tooltip';
import { Telemetry } from '@macro-inc/observability';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useHotkeyDOMScope } from './hotkeys';
import { activeScope, setActiveScope } from './state';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(() => {
  vi.restoreAllMocks();
  setActiveScope('global');
});

const focusIn = (el: Element) => {
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
};

// Solid calls a spread `ref` from a render effect. Kobalte's tooltip trigger
// spreads its open state (`data-expanded`) beside the ref, so every tooltip
// open or close re-runs the ref with the element it already attached, as on
// the saved-views + button. The @ui Tooltip never opens under test, so this
// drives Kobalte's trigger directly.
describe('useHotkeyDOMScope re-attaching the same element', () => {
  test('a tooltip trigger re-running its ref does not report a duplicate scope', () => {
    const error = vi.spyOn(Telemetry, 'error');
    const [open, setOpen] = createSignal(false);
    let scopeId = '';

    const view = render(() => {
      const [attach, id] = useHotkeyDOMScope('reattach-test', true);
      scopeId = id;
      return (
        <Tooltip open={open()}>
          <Tooltip.Trigger ref={attach} aria-label="New saved view" />
        </Tooltip>
      );
    });
    const button = view.getByRole('button', { name: 'New saved view' });

    setOpen(true);
    setOpen(false);

    expect(error).not.toHaveBeenCalled();
    expect(button.getAttribute('data-hotkey-scope')).toBe(scopeId);

    // The focus listener survives the ref re-runs.
    focusIn(button);
    expect(activeScope()).toBe(scopeId);
    view.unmount();
  });

  test('attaching a second scope to an element that has one still reports it', () => {
    const error = vi.spyOn(Telemetry, 'error');
    const el = document.createElement('div');

    const view = render(() => {
      const [attachA] = useHotkeyDOMScope('reattach-a', true);
      const [attachB] = useHotkeyDOMScope('reattach-b', true);
      attachA(el);
      attachB(el);
      return null;
    });

    expect(error).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
