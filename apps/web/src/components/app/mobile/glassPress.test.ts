import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));

import { glassPressGeometry, installGlassPress } from './glassPress';

let dispose: () => void;
function pointer(element: Element, type: string, x = 20, y = 20) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
  });
  element.dispatchEvent(event);
}
function surface(width = 300, height = 46) {
  const group = document.createElement('div');
  group.dataset.mobileDockIsland = '';
  group.innerHTML =
    '<button><span>First</span></button><button>Second</button>';
  Object.defineProperties(group, {
    offsetWidth: { value: width },
    offsetHeight: { value: height },
  });
  group.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  document.body.append(group);
  return group;
}
beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no pseudo-element styles; their animation is checked in a browser.
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
    computedStyle(element)
  );
  dispose = installGlassPress();
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('mobile glass surface press', () => {
  it('keeps round growth at 30% and caps wide displacement independently of width', () => {
    expect(glassPressGeometry(46, 46).round).toBe(true);
    expect(glassPressGeometry(46, 46).scale).toBeCloseTo(1.3);
    expect(glassPressGeometry(300, 46).outset).toBe(3);
    expect(glassPressGeometry(600, 46).outset).toBe(3);
    expect(glassPressGeometry(600, 80).outset).toBe(3);
  });
  it('owns the press and tap-centered highlight on the outer dock', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    pointer(button.querySelector('span')!, 'pointerdown');
    expect(group.dataset.glassPress).toBe('wide');
    expect(group.hasAttribute('data-glass-pressed')).toBe(true);
    expect(button.hasAttribute('data-glass-press')).toBe(false);
    expect(group.style.getPropertyValue('--press-x')).toBe('20px');
    expect(group.style.getPropertyValue('--press-y')).toBe('20px');
    expect(
      group.querySelector('[data-glass-shimmer]')?.getAttribute('aria-hidden')
    ).toBe('true');
  });
  it('places the highlight in local coordinates on a translated, scaled surface', () => {
    const group = surface(46, 46);
    group.getBoundingClientRect = () => new DOMRect(100, 200, 59.8, 59.8);
    pointer(group.querySelector('button')!, 'pointerdown', 129.9, 229.9);
    expect(parseFloat(group.style.getPropertyValue('--press-x'))).toBeCloseTo(
      23
    );
    expect(parseFloat(group.style.getPropertyValue('--press-y'))).toBeCloseTo(
      23
    );
  });
  it('ignores disabled controls inside an otherwise enabled group', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    button.disabled = true;
    pointer(button, 'pointerdown');
    expect(group.hasAttribute('data-glass-press')).toBe(false);
  });
  it.each(['pointerup', 'pointercancel', 'pointermove'])(
    'releases on %s and restores live theme styles',
    (event) => {
      const group = surface();
      const button = group.querySelector('button')!;
      pointer(button, 'pointerdown');
      pointer(button, event, event === 'pointermove' ? 400 : 20);
      expect(group.hasAttribute('data-glass-pressed')).toBe(false);
      vi.advanceTimersByTime(320);
      expect(group.hasAttribute('data-glass-press')).toBe(false);
      expect(group.style.getPropertyValue('--press-fill')).toBe('');
      expect(group.style.getPropertyValue('--press-x')).toBe('');
      expect(group.querySelector('[data-glass-shimmer]')).toBeNull();
    }
  );
  it('keeps a rapid second press alive past the first release timer', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    pointer(button, 'pointerdown');
    const shimmer = group.querySelector('[data-glass-shimmer]');
    pointer(button, 'pointerup');
    vi.advanceTimersByTime(100);
    pointer(button, 'pointerdown', 120);
    vi.advanceTimersByTime(320);
    expect(group.hasAttribute('data-glass-pressed')).toBe(true);
    expect(group.querySelectorAll('[data-glass-shimmer]').length).toBe(1);
    expect(group.querySelector('[data-glass-shimmer]')).toBe(shimmer);
    expect(group.style.getPropertyValue('--press-x')).toBe('120px');
    dispose();
    expect(group.hasAttribute('data-glass-press')).toBe(false);
    expect(group.querySelector('[data-glass-shimmer]')).toBeNull();
  });
});
