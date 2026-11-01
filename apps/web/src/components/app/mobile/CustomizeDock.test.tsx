import { hapticImpact } from '@core/mobile/haptics';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CustomizeDock } from './CustomizeDock';
import { MobileDrawer } from './MobileDrawer';
import type { MobileDockView } from './mobile-dock-views';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const rows = [...document.querySelectorAll('[data-dock-order-item]')];
      const index = rows.indexOf(this);
      return new DOMRect(
        50,
        100 + Math.max(index, 0) * 60,
        300,
        index < 0 ? 400 : 56
      );
    }
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const [views, setViews] = createSignal<MobileDockView[]>([
    { id: 'home', label: 'Notifications', icon: () => <svg /> },
    { id: 'mail', label: 'Email', icon: () => <svg /> },
    { id: 'tasks', label: 'Tasks', icon: () => <svg /> },
  ]);
  const onMove = vi.fn((from: number, to: number) => {
    setViews((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  });
  render(() => (
    <MobileDrawer open>
      <MobileDrawer.Content>
        <CustomizeDock
          views={views()}
          visibleCount={1}
          onBack={() => {}}
          onMove={onMove}
        />
      </MobileDrawer.Content>
    </MobileDrawer>
  ));
  return {
    onMove,
    views,
    handle: screen.getByRole('button', { name: 'Reorder Tasks' }),
  };
}
const touch = (y: number) => ({ identifier: 1, clientX: 320, clientY: y });

it('lets touches outside the handle scroll without reordering', () => {
  const { onMove } = mount();
  const handle = screen.getByText('Tasks');
  fireEvent.touchStart(handle, { touches: [touch(248)] });
  expect(fireEvent.touchMove(handle, { touches: [touch(200)] })).toBe(true);
  vi.advanceTimersByTime(350);
  fireEvent.touchEnd(handle, { touches: [], changedTouches: [touch(200)] });
  expect(onMove).not.toHaveBeenCalled();
});

it('drags immediately across the menu/dock boundary without a hold', () => {
  const { handle, onMove, views } = mount();
  fireEvent.touchStart(handle, { touches: [touch(248)] });
  expect(fireEvent.touchMove(handle, { touches: [touch(128)] })).toBe(false);
  fireEvent.touchEnd(handle, { touches: [], changedTouches: [touch(128)] });
  expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 0);
  expect(views()[0].id).toBe('tasks');
  expect(hapticImpact).toHaveBeenCalledExactlyOnceWith('light');
  expect(screen.getByRole('status').textContent).toContain('in dock');
});

it.each(['touchcancel', 'escape', 'blur', 'multitouch'])(
  'cancels a touch drag on %s without saving',
  (reason) => {
    const { handle, onMove } = mount();
    fireEvent.touchStart(handle, { touches: [touch(248)] });
    fireEvent.touchMove(handle, { touches: [touch(128)] });
    if (reason === 'touchcancel') fireEvent.touchCancel(handle);
    if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (reason === 'blur') fireEvent.blur(window);
    if (reason === 'multitouch')
      fireEvent.touchStart(document, {
        touches: [touch(128), { ...touch(150), identifier: 2 }],
      });
    fireEvent.touchEnd(handle, { touches: [], changedTouches: [touch(128)] });
    expect(onMove).not.toHaveBeenCalled();
  }
);

it('supports mouse dragging and cancels it with Escape', () => {
  const { handle, onMove } = mount();
  fireEvent.mouseDown(handle, { button: 0, clientX: 320, clientY: 248 });
  fireEvent.mouseMove(document, { clientX: 320, clientY: 128 });
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.mouseUp(document, { clientX: 320, clientY: 128 });
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.mouseDown(handle, { button: 0, clientX: 320, clientY: 248 });
  fireEvent.mouseMove(document, { clientX: 320, clientY: 128 });
  fireEvent.mouseUp(document, { clientX: 320, clientY: 128 });
  expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 0);
});

it('cleans up a pending handle touch when the drawer unmounts', () => {
  const { handle, onMove } = mount();
  fireEvent.touchStart(handle, { touches: [touch(248)] });
  cleanup();
  vi.advanceTimersByTime(500);
  expect(onMove).not.toHaveBeenCalled();
  expect(hapticImpact).not.toHaveBeenCalled();
});

it.each(['touchcancel', 'escape', 'blur', 'multitouch'])(
  'does not activate a pending drag after %s',
  (reason) => {
    const { handle, onMove } = mount();
    fireEvent.touchStart(handle, { touches: [touch(248)] });
    if (reason === 'touchcancel') fireEvent.touchCancel(handle);
    if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (reason === 'blur') fireEvent.blur(window);
    if (reason === 'multitouch')
      fireEvent.touchStart(document, {
        touches: [touch(248), { ...touch(150), identifier: 2 }],
      });
    vi.advanceTimersByTime(350);
    expect(hapticImpact).not.toHaveBeenCalled();
    expect(fireEvent.touchMove(handle, { touches: [touch(128)] })).toBe(true);
    fireEvent.touchEnd(handle, { touches: [], changedTouches: [touch(128)] });
    expect(onMove).not.toHaveBeenCalled();
  }
);

it('keeps tap and small finger movements from reordering or firing haptics', () => {
  const { handle, onMove } = mount();
  fireEvent.touchStart(handle, { touches: [touch(248)] });
  fireEvent.touchMove(handle, { touches: [touch(250)] });
  fireEvent.touchEnd(handle, { touches: [], changedTouches: [touch(250)] });
  expect(onMove).not.toHaveBeenCalled();
  expect(hapticImpact).not.toHaveBeenCalled();
});
