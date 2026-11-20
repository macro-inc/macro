import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createScrollTopFade } from './createScrollTopFade';

const device = vi.hoisted(() => ({ touch: false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

afterEach(() => {
  document.body.replaceChildren();
  device.touch = false;
  vi.useRealTimers();
});

it('leaves an initially scrolled desktop pane clear through delayed restoration', () => {
  const element = document.createElement('div');
  element.scrollTop = 400;
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(() => element);
  });

  expect(element.style.maskImage).toBe('');
  element.scrollTop = 800;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');
  dispose();
});

it('fades only after a vertical wheel gesture actually scrolls the pane', () => {
  const element = document.createElement('div');
  element.scrollTop = 400;
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(() => element);
  });

  element.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
  expect(element.style.maskImage).toBe('');
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');
  element.scrollTop = 420;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe(
    'linear-gradient(to bottom, transparent, black 32px)'
  );

  element.scrollTop = 12;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toContain('black 12px');
  element.scrollTop = 0;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');
  dispose();
});

it('ignores horizontal wheels, zoom gestures, and expired scroll intent', () => {
  vi.useFakeTimers();
  const element = document.createElement('div');
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(() => element);
  });

  element.dispatchEvent(new WheelEvent('wheel', { deltaX: 20 }));
  element.scrollTop = 100;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');

  element.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, ctrlKey: true }));
  element.scrollTop = 200;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');

  element.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
  vi.advanceTimersByTime(1000);
  element.scrollTop = 300;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');
  dispose();
});

it('restores an existing mask and resets activation when the scroller changes', () => {
  const first = document.createElement('div');
  first.style.maskImage = 'linear-gradient(black, black)';
  const second = document.createElement('div');
  second.scrollTop = 500;
  let dispose = () => {};
  const [element, setElement] = createSignal<HTMLElement>(first);
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(element);
  });

  first.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
  first.scrollTop = 100;
  first.dispatchEvent(new Event('scroll'));
  expect(first.style.maskImage).toContain('black 32px');
  setElement(second);
  expect(first.style.maskImage).toBe('linear-gradient(black, black)');
  expect(second.style.maskImage).toBe('');
  first.scrollTop = 200;
  first.dispatchEvent(new Event('scroll'));
  expect(first.style.maskImage).toBe('linear-gradient(black, black)');
  dispose();
});

it('leaves touch scrollers unmasked so their floating chrome owns the scrim', () => {
  device.touch = true;
  const element = document.createElement('div');
  element.scrollTop = 500;
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(() => element);
  });

  element.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
  element.scrollTop = 600;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');
  dispose();
});

it('recognizes ancestor-focused keyboard navigation but ignores editing controls', () => {
  const grid = document.createElement('div');
  const wrapper = document.createElement('div');
  const element = document.createElement('div');
  const input = document.createElement('input');
  wrapper.append(element);
  grid.append(wrapper, input);
  document.body.append(grid);
  element.scrollTop = 300;
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(() => element);
  });

  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
  );
  element.scrollTop = 320;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');

  grid.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })
  );
  expect(element.style.maskImage).toBe('');
  element.scrollTop = 500;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toContain('black 32px');
  dispose();
});

it('recognizes sibling scrollbar input and releases pointer tracking outside the pane', () => {
  vi.useFakeTimers();
  const wrapper = document.createElement('div');
  const element = document.createElement('div');
  const scrollbar = document.createElement('div');
  wrapper.append(element, scrollbar);
  document.body.append(wrapper);
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    createScrollTopFade(() => element);
  });

  scrollbar.dispatchEvent(
    new MouseEvent('pointerdown', { button: 0, bubbles: true })
  );
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  vi.advanceTimersByTime(1000);
  document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  element.scrollTop = 200;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');

  scrollbar.dispatchEvent(
    new MouseEvent('pointerdown', { button: 0, bubbles: true })
  );
  element.scrollTop = 400;
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toContain('black 32px');
  dispose();
});
