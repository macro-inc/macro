import { cleanup, render } from '@solidjs/testing-library';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullToRefresh } from './PullToRefresh';

vi.mock('@tauri-apps/plugin-haptics', () => ({
  impactFeedback: vi.fn(async () => {}),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => true,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function touch(target: Element, type: string, y?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = y === undefined ? [] : [{ clientX: 50, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
}

function renderList() {
  const onRefresh = vi.fn(async () => {});
  let list!: HTMLDivElement;
  render(() => {
    const [container, setContainer] = createSignal<HTMLElement>();
    return (
      <div>
        <div
          ref={(el) => {
            list = el;
            setContainer(el);
          }}
        />
        <PullToRefresh scrollContainer={container} onRefresh={onRefresh} />
      </div>
    );
  });
  return { list, onRefresh };
}

it('taps a light impact as a pull arms the refresh and as it disarms', () => {
  const { list, onRefresh } = renderList();

  touch(list, 'touchstart', 100);
  touch(list, 'touchmove', 150);
  expect(impactFeedback).not.toHaveBeenCalled();
  touch(list, 'touchmove', 260);
  expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('light');
  touch(list, 'touchmove', 280);
  expect(impactFeedback).toHaveBeenCalledOnce();
  touch(list, 'touchmove', 150);
  expect(impactFeedback).toHaveBeenCalledTimes(2);
  expect(impactFeedback).toHaveBeenLastCalledWith('light');
  touch(list, 'touchend');

  expect(onRefresh).not.toHaveBeenCalled();
});
