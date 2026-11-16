import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileDrawer } from './MobileDrawer';

let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content] { transition-duration: 0s; animation-name: none; }';
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
  setVirtualKeyboardVisible(false);
});
afterEach(() => {
  cleanup();
  drawerStyles.remove();
  setVirtualKeyboardVisible(false);
  vi.unstubAllGlobals();
});

describe('mobile drawer keyboard layouts', () => {
  it('keeps the existing content keyboard offset and viewport clamp', () => {
    const { container } = render(() => (
      <MobileDrawer
        initialOpen
        preventScroll={false}
        preventScrollbarShift={false}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Content aria-label="Default" targetHeight={70}>
            <MobileDrawer.ScrollBody>Rows</MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    ));
    const sheet = screen.getByRole('dialog', { name: 'Default' });
    expect(sheet.style.getPropertyValue('--drawer-h')).toBe('70dvh');
    expect(sheet.className).toContain(
      'bottom-[calc(var(--virtual-keyboard-height,0px)+8px)]'
    );
    expect(sheet.className).toContain(
      '100dvh-var(--safe-top,0px)-var(--virtual-keyboard-height,0px)-16px'
    );
    expect(sheet.style.getPropertyValue('--drawer-keyboard-inset')).toBe('');
    expect(container.querySelector('[data-drawer-scroll-body]')).toBeNull();
    setVirtualKeyboardVisible(true);
    expect(sheet.className).toContain('pb-4');
    expect(sheet.className).toContain(
      'bottom-[calc(var(--virtual-keyboard-height,0px)+8px)]'
    );
    expect(sheet.style.getPropertyValue('--drawer-keyboard-inset')).toBe('');
  });

  it('pins fixed content and reserves keyboard space for a footer below the flexing thread', () => {
    const { unmount } = render(() => (
      <MobileDrawer
        initialOpen
        preventScroll={false}
        preventScrollbarShift={false}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.FixedContent aria-label="Thread" targetHeight={90}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>Messages</MobileDrawer.ScrollBody>
            <MobileDrawer.KeyboardFooter data-testid="composer">
              Compose
            </MobileDrawer.KeyboardFooter>
          </MobileDrawer.FixedContent>
        </MobileDrawer.Portal>
      </MobileDrawer>
    ));
    const sheet = screen.getByRole('dialog', { name: 'Thread' });
    const thread = sheet.querySelector('[data-drawer-scroll-body]');
    const footer = screen.getByTestId('composer');
    expect(sheet.style.getPropertyValue('--drawer-h')).toBe('90dvh');
    expect(sheet.style.getPropertyValue('--drawer-max-h')).toBe('90dvh');
    expect(sheet.className).toContain('bottom-2');
    expect(sheet.className).toContain('100dvh-var(--safe-top,0px)-16px');
    expect(sheet.className).toContain(
      'pb-[max(16px,var(--mobile-sheet-safe-padding))]'
    );
    expect(sheet.style.getPropertyValue('--drawer-keyboard-inset')).toBe('0px');
    expect(thread?.className).toContain('min-h-0 flex-auto');
    expect(footer.className).toContain('shrink-0');
    expect(footer.previousElementSibling).toBe(thread);

    setVirtualKeyboardVisible(true);
    expect(sheet.style.getPropertyValue('--drawer-keyboard-inset')).toBe(
      'max(var(--virtual-keyboard-height,0px),calc(100dvh - var(--dvh,1dvh)*100))'
    );
    expect(sheet.style.getPropertyValue('--drawer-h')).toBe('90dvh');
    expect(sheet.className).toContain('bottom-2');
    expect(sheet.className).toContain('pb-(--drawer-keyboard-inset)');
    setVirtualKeyboardVisible(false);
    expect(sheet.style.getPropertyValue('--drawer-keyboard-inset')).toBe('0px');
    unmount();
  });
});
