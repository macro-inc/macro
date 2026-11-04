import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Resize } from './Resize';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 1000, height: 600 }),
}));

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function pointer(target: EventTarget, type: string, x: number, pointerId = 1) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: x,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  target.dispatchEvent(event);
}

function setup(direction: 'horizontal' | 'vertical' = 'horizontal', zoom = 1) {
  const onSizeChangeEnd = vi.fn();
  const [gutter, setGutter] = createSignal(8);
  const view = render(() => (
    <Resize.Zone direction={direction} gutter={gutter()}>
      <Resize.Panel id="first" minSize={100} onSizeChangeEnd={onSizeChangeEnd}>
        First
      </Resize.Panel>
      <Resize.Panel id="second" minSize={100}>
        Second
      </Resize.Panel>
    </Resize.Zone>
  ));
  const zone = view.container.querySelector<HTMLElement>('[data-resize-zone]')!;
  const panel = view.container.querySelector<HTMLElement>(
    '[data-resize-panel]'
  )!;
  Object.defineProperties(zone, {
    offsetWidth: { value: 1000 },
    offsetHeight: { value: 600 },
  });
  const measure = vi
    .spyOn(zone, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 1000 * zoom, 600 * zoom));
  return {
    ...view,
    handle: view.getByRole('separator'),
    panel,
    measure,
    onSizeChangeEnd,
    setGutter,
  };
}

describe('split resize interactions', () => {
  it('finishes an applied drag when its handle unmounts but the zone stays mounted', () => {
    const view = setup();
    pointer(view.handle, 'pointerdown', 500);
    pointer(window, 'pointermove', 560);
    vi.advanceTimersToNextFrame();
    expect(view.panel.style.width).toBe('556px');
    pointer(window, 'pointermove', 600);
    view.setGutter(0);
    expect(view.queryByRole('separator')).toBeNull();
    expect(view.onSizeChangeEnd).toHaveBeenCalledOnce();
    expect(view.onSizeChangeEnd).toHaveBeenCalledWith(556);
    pointer(window, 'pointerup', 600);
    vi.advanceTimersToNextFrame();
    expect(view.onSizeChangeEnd).toHaveBeenCalledOnce();
    expect(view.measure).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('coalesces pointer samples and saves the final release position', () => {
    const view = setup();
    expect(view.panel.style.width).toBe('496px');
    pointer(view.handle, 'pointerdown', 500);
    pointer(window, 'pointermove', 510);
    pointer(window, 'pointermove', 540);
    pointer(window, 'pointermove', 560);
    expect(view.panel.style.width).toBe('496px');
    expect(view.measure).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(view.panel.style.width).toBe('556px');
    expect(view.measure).toHaveBeenCalledTimes(1);
    pointer(window, 'pointermove', 580);
    pointer(window, 'pointerup', 590);
    expect(view.panel.style.width).toBe('586px');
    expect(view.onSizeChangeEnd).toHaveBeenCalledExactlyOnceWith(586);
    vi.advanceTimersToNextFrame();
    pointer(window, 'pointermove', 700);
    vi.advanceTimersToNextFrame();
    expect(view.panel.style.width).toBe('586px');
    view.unmount();
  });

  it.each(['horizontal', 'vertical'] as const)(
    'preserves %s resize distances under CSS zoom',
    (direction) => {
      const view = setup(direction, 2);
      pointer(view.handle, 'pointerdown', 500);
      pointer(window, 'pointermove', 580);
      vi.advanceTimersToNextFrame();
      expect(
        direction === 'horizontal'
          ? view.panel.style.width
          : view.panel.style.height
      ).toBe(direction === 'horizontal' ? '536px' : '336px');
      pointer(window, 'pointerup', 580);
      view.unmount();
    }
  );

  it.each(['pointercancel', 'lostpointercapture'])(
    'finishes pending work on %s and ignores other pointers',
    (type) => {
      const view = setup();
      pointer(view.handle, 'pointerdown', 500);
      pointer(window, 'pointermove', 900, 2);
      pointer(window, 'pointerup', 900, 2);
      pointer(window, 'pointermove', 520);
      pointer(type === 'lostpointercapture' ? view.handle : window, type, 0);
      expect(view.panel.style.width).toBe('516px');
      expect(view.onSizeChangeEnd).toHaveBeenCalledExactlyOnceWith(516);
      pointer(window, 'pointermove', 600);
      vi.advanceTimersToNextFrame();
      expect(view.panel.style.width).toBe('516px');
      view.unmount();
    }
  );

  it('cancels queued work and removes drag listeners on unmount', () => {
    const view = setup();
    pointer(view.handle, 'pointerdown', 500);
    pointer(window, 'pointermove', 550);
    view.unmount();
    pointer(window, 'pointermove', 600);
    pointer(window, 'pointerup', 600);
    vi.advanceTimersToNextFrame();
    expect(view.measure).not.toHaveBeenCalled();
    expect(view.onSizeChangeEnd).not.toHaveBeenCalled();
  });

  it('keeps keyboard resizing immediate and clamps at panel minimums', async () => {
    const view = setup();
    fireEvent.keyDown(view.handle, { key: 'ArrowRight' });
    expect(view.panel.style.width).toBe('516px');
    await Promise.resolve();
    expect(view.onSizeChangeEnd).toHaveBeenCalledWith(516);
    pointer(view.handle, 'pointerdown', 520);
    pointer(window, 'pointermove', 0);
    vi.advanceTimersToNextFrame();
    expect(view.panel.style.width).toBe('100px');
    pointer(window, 'pointermove', 20);
    vi.advanceTimersToNextFrame();
    expect(view.panel.style.width).toBe('120px');
    pointer(window, 'pointerup', 20);
    view.unmount();
  });
});
