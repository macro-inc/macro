import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, Show, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SplitPanelContext } from '../context';
import type { SplitContent, SplitMount } from '../layoutManager';
import { PopoverSplitRenderer } from './PopoverSplitRenderer';

vi.mock('@app/features/next-soup/soup-context', () => ({
  SoupContextProvider: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
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

it.each([undefined, 82])(
  'exposes one scroll body and returns to natural height when a %s-height owner unmounts',
  (requestedHeight) => {
    const content: SplitContent = { type: 'component', id: 'test-composer' };
    const Fill = (props: { height?: number }) => {
      const panel = useContext(SplitPanelContext);
      panel?.fillDrawer?.(props.height, { opaque: props.height !== 90 });
      return <div>Filling content</div>;
    };
    const TestContent = () => {
      const panel = useContext(SplitPanelContext);
      const [filling, setFilling] = createSignal(false);
      const [otherFilling, setOtherFilling] = createSignal(false);
      const [footerVisible, setFooterVisible] = createSignal(false);
      return (
        <>
          <button onClick={() => setFilling((current) => !current)}>
            Toggle fill
          </button>
          <button onClick={() => setOtherFilling((current) => !current)}>
            Toggle other fill
          </button>
          <button onClick={() => setFooterVisible((current) => !current)}>
            Toggle footer
          </button>
          <Show when={filling()}>
            <Fill height={requestedHeight} />
          </Show>
          <Show when={otherFilling()}>
            <Fill height={90} />
          </Show>
          <Show when={footerVisible() && panel?.drawerFooter?.()}>
            {(footer) => <Portal mount={footer()}>Pinned actions</Portal>}
          </Show>
          <span data-testid="scroll-ref">
            {panel
              ?.drawerScrollBody?.()
              ?.hasAttribute('data-drawer-scroll-body')
              ? 'scroll body available'
              : 'scroll body missing'}
          </span>
        </>
      );
    };
    const mount: SplitMount = {
      kind: 'component',
      name: 'test-composer',
      meta: {},
      updateMeta: () => {},
      element: TestContent,
    };
    render(() => {
      useHotKeyRoot();
      return (
        <PopoverSplitRenderer
          popovers={() =>
            new Map([
              [
                'composer',
                {
                  id: 'composer',
                  content,
                  mount,
                  isOpen: true,
                  options: { content },
                },
              ],
            ])
          }
        />
      );
    });

    const drawer = screen.getByRole('dialog');
    const scroller = drawer.querySelector('[data-drawer-scroll-body]');
    const footer = drawer.querySelector('[data-drawer-footer]');
    expect(drawer.querySelectorAll('[data-drawer-scroll-body]')).toHaveLength(
      1
    );
    expect(scroller?.nextElementSibling).toBe(footer);
    expect(footer?.childElementCount).toBe(0);
    expect(screen.getByTestId('scroll-ref').textContent).toBe(
      'scroll body available'
    );
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle footer' }));
    expect(footer?.textContent).toBe('Pinned actions');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle fill' }));
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe(
      `${requestedHeight ?? 70}dvh`
    );
    expect(drawer.classList.contains('bg-menu')).toBe(true);
    expect(drawer.style.getPropertyValue('--drawer-max-h')).toBe('92dvh');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle other fill' }));
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe('90dvh');
    expect(drawer.classList.contains('bg-menu')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle fill' }));
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe('90dvh');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle fill' }));
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe(
      `${requestedHeight ?? 70}dvh`
    );
    expect(drawer.classList.contains('bg-menu')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle other fill' }));
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe(
      `${requestedHeight ?? 70}dvh`
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle fill' }));
    expect(drawer.style.getPropertyValue('--drawer-h')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle footer' }));
    expect(footer?.childElementCount).toBe(0);
  }
);
