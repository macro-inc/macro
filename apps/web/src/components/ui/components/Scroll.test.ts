import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Scroll } from './Scroll';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses the inset track for vertical thumb geometry and seeking while bounding inset values', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
  const [inset, setInset] = createSignal(68);
  let viewport!: HTMLDivElement;
  const view = render(() =>
    createComponent(Scroll, {
      orientation: 'both',
      scrollbars: 'both',
      autoHide: false,
      get verticalScrollbarInset() {
        return inset();
      },
      scrollRef: (element) => {
        viewport = element;
      },
      children: 'Scrollable content',
    })
  );
  const gutter = view.getByRole('scrollbar', { name: 'Scroll vertically' });
  const thumb = gutter.firstElementChild as HTMLElement;
  expect(gutter.style.top).toBe('68px');
  expect(gutter.style.bottom).toBe('10px');
  expect(Number.parseFloat(thumb.style.height)).toBeCloseTo(64.8);
  viewport.scrollTop = 350;
  fireEvent.scroll(viewport);
  expect(thumb.style.transform).toBe('translateY(78.6px)');

  gutter.getBoundingClientRect = () => new DOMRect(390, 68, 10, 222);
  gutter.setPointerCapture = vi.fn();
  gutter.hasPointerCapture = () => true;
  const pointer = (type: string, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientY });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(gutter, event);
  };
  pointer('pointerdown', 68 + 78.6 + 32.4);
  pointer('pointermove', 68 + 3 + 151.2 + 32.4);
  expect(viewport.scrollTop).toBeCloseTo(700);
  setInset(-10);
  expect(gutter.style.top).toBe('0px');
  setInset(1000);
  expect(gutter.style.top).toBe('290px');
  expect(Number.parseFloat(thumb.style.height)).toBe(0);
});
