import { hapticImpact } from '@core/mobile/haptics';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileDockButton } from './MobileDockButton';
import { MobileDrawer } from './MobileDrawer';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  // Supply browser motion defaults missing in jsdom for Corvu's presence tracking.
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content], [data-corvu-drawer-overlay] { transition-duration: 0s; animation-name: none; }';
  document.head.append(drawerStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  drawerStyles.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const activate = vi.fn();
  const { getByRole } = render(() => (
    <MobileDockButton
      icon={() => <svg />}
      ariaLabel="Calendar"
      onClick={activate}
    />
  ));
  const button = getByRole('button');
  const press = (pointerType: string, isPrimary = true, mouseButton = 0) => {
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(event, { pointerType, isPrimary, button: mouseButton });
    fireEvent(button, event);
    return event;
  };
  return { activate, button, press };
}
describe('mobile dock activation', () => {
  it.each(['touch', 'pen', 'mouse'])(
    'gives haptic feedback on %s down and activates on click',
    (pointerType) => {
      const { activate, button, press } = setup();
      expect(press(pointerType).defaultPrevented).toBe(false);
      expect(hapticImpact).toHaveBeenCalledExactlyOnceWith('light');
      expect(activate).not.toHaveBeenCalled();
      fireEvent.pointerUp(button);
      expect(activate).not.toHaveBeenCalled();
      fireEvent.click(button, { detail: 1 });
      expect(activate).toHaveBeenCalledTimes(1);
      expect(hapticImpact).toHaveBeenCalledTimes(1);
      press(pointerType);
      expect(activate).toHaveBeenCalledTimes(1);
    }
  );
  it('does not activate a cancelled touch and still accepts keyboard or assistive clicks', () => {
    const { activate, button, press } = setup();
    press('touch');
    fireEvent.pointerCancel(button);
    expect(activate).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 0 });
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('allows compatibility mouse-down without activating before click', () => {
    const { activate, button, press } = setup();
    press('touch');
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(button, event);
    expect(event.defaultPrevented).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 1 });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('forwards the drawer trigger ref, accessibility props, and click event', async () => {
    let triggerRef: HTMLButtonElement | undefined;
    const onClick = vi.fn();
    const select = vi.fn();
    const { getByRole, queryByRole } = render(() => (
      <MobileDrawer preventScroll={false} preventScrollbarShift={false}>
        <MobileDrawer.Trigger
          as={MobileDockButton}
          ref={(element) => {
            triggerRef = element;
          }}
          icon={() => <svg />}
          ariaLabel="More views"
          onClick={onClick}
        />
        <MobileDrawer.Portal>
          <MobileDrawer.Content aria-label="More views">
            <MobileDrawer.Close
              as={MobileDrawer.Item}
              aria-label="Calendar"
              onClick={select}
            >
              Calendar
            </MobileDrawer.Close>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    ));
    const trigger = getByRole('button', { name: 'More views' });
    expect(triggerRef).toBe(trigger);
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    expect(queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    expect(onClick.mock.calls[0][0]).toBeInstanceOf(MouseEvent);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog').id).toBe(
      trigger.getAttribute('aria-controls')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(select).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
