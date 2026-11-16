import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
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
  vi.restoreAllMocks();
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

  it('resizes the visible body with controlled snap points without remounting or scrolling it', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
    const [point, setPoint] = createSignal<number>(0.5);
    render(() => (
      <MobileDrawer
        initialOpen
        snapPoints={[0, 0.5, 1]}
        defaultSnapPoint={0.5}
        activeSnapPoint={point()}
        onActiveSnapPointChange={(value) => {
          if (typeof value === 'number') setPoint(value);
        }}
        preventScroll={false}
        preventScrollbarShift={false}
      >
        <MobileDrawer.FixedContent
          aria-label="Snapping"
          targetHeight={100}
          fitSnapPoint
        >
          <MobileDrawer.Handle data-testid="grabber" />
          <MobileDrawer.Title>Thread</MobileDrawer.Title>
          <MobileDrawer.ScrollBody>Messages</MobileDrawer.ScrollBody>
          <MobileDrawer.KeyboardFooter>Input</MobileDrawer.KeyboardFooter>
        </MobileDrawer.FixedContent>
      </MobileDrawer>
    ));
    const sheet = screen.getByRole('dialog', { name: 'Thread' });
    const thread = sheet.querySelector<HTMLElement>(
      '[data-drawer-scroll-body]'
    )!;
    const footer = sheet.querySelector('[data-drawer-keyboard-footer]');
    thread.scrollTop = 120;
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('400px');
    setPoint(1);
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('0px');
    expect(thread.scrollTop).toBe(120);
    setVirtualKeyboardVisible(true);
    expect(sheet.style.getPropertyValue('--drawer-keyboard-inset')).not.toBe(
      '0px'
    );
    expect(sheet.querySelector('[data-drawer-keyboard-footer]')).toBe(footer);
    setVirtualKeyboardVisible(false);
    setPoint(0.5);
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('400px');
    expect(sheet.querySelector('[data-drawer-scroll-body]')).toBe(thread);
    expect(thread.scrollTop).toBe(120);
  });

  it('snaps header drags in both directions and restores a rejected dismiss to the last open point', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onOpenChange = vi.fn();
    render(() => (
      <MobileDrawer
        open
        snapPoints={[0, 0.5, 1]}
        defaultSnapPoint={0.5}
        onOpenChange={onOpenChange}
        velocityFunction={() => 1}
        preventScroll={false}
        preventScrollbarShift={false}
      >
        {() => {
          const drawer = MobileDrawer.useContext();
          return (
            <MobileDrawer.FixedContent
              aria-label="Draggable"
              targetHeight={100}
              fitSnapPoint
            >
              <MobileDrawer.Handle data-testid="drag-handle" />
              <MobileDrawer.Title
                onClick={() => drawer.setActiveSnapPoint(0.5)}
              >
                Drag header
              </MobileDrawer.Title>
              <MobileDrawer.ScrollBody>Messages</MobileDrawer.ScrollBody>
            </MobileDrawer.FixedContent>
          );
        }}
      </MobileDrawer>
    ));
    const sheet = screen.getByRole('dialog', { name: 'Drag header' });
    const header = screen.getByText('Drag header');
    const handle = screen.getByTestId('drag-handle');
    fireEvent.click(header);
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerType: 'mouse',
      clientY: 500,
    });
    fireEvent.pointerMove(handle, { clientY: 490 });
    fireEvent.pointerMove(handle, { clientY: 180 });
    fireEvent.pointerUp(handle, { pointerType: 'mouse' });
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('0px');
    const thread = screen.getByText('Messages');
    thread.style.overflowY = 'auto';
    Object.defineProperty(thread, 'scrollHeight', { value: 1600 });
    thread.scrollTop = 120;
    fireEvent.pointerDown(thread, { button: 0, clientY: 100 });
    fireEvent.pointerMove(thread, { clientY: 110 });
    fireEvent.pointerMove(thread, { clientY: 420 });
    fireEvent.pointerUp(thread);
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('0px');
    thread.scrollTop = 0;
    fireEvent.pointerDown(header, {
      button: 0,
      pointerType: 'mouse',
      clientY: 100,
    });
    fireEvent.pointerMove(header, { clientY: 110 });
    fireEvent.pointerMove(header, { clientY: 420 });
    fireEvent.pointerUp(header, { pointerType: 'mouse' });
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('400px');
    fireEvent.pointerDown(header, {
      button: 0,
      pointerType: 'mouse',
      clientY: 420,
    });
    fireEvent.pointerMove(header, { clientY: 430 });
    fireEvent.pointerMove(header, { clientY: 750 });
    fireEvent.pointerUp(header, { pointerType: 'mouse' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(sheet.style.getPropertyValue('--drawer-snap-inset')).toBe('400px');
  });
});
