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
    pointerType: { value: 'touch' },
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
  dispose = installGlassPress();
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('mobile glass surface press', () => {
  it('keeps round growth at 20% and caps wide displacement independently of width', () => {
    expect(glassPressGeometry(46, 46).round).toBe(true);
    expect(glassPressGeometry(46, 46).scale).toBeCloseTo(1.2);
    expect(glassPressGeometry(300, 46).outset).toBe(3);
    expect(glassPressGeometry(600, 46).outset).toBe(3);
    expect(glassPressGeometry(600, 80).outset).toBe(3);
  });
  it('owns the press and tap-centered highlight on the outer dock', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    pointer(button.querySelector('span')!, 'pointerdown');
    expect(group.dataset.glassPress).toBe('wide');
    expect(button.hasAttribute('data-glass-press')).toBe(false);
    expect(group.style.getPropertyValue('--press-x')).toBe('20px');
    expect(group.style.getPropertyValue('--press-y')).toBe('20px');
    expect(group.children).toHaveLength(2);
  });
  it.each(['glass', 'island', 'touch:island'])(
    'animates standalone %s buttons without per-control setup',
    (className) => {
      const button = document.createElement('button');
      button.className = className;
      button.innerHTML = '<span>Open filters</span>';
      Object.defineProperties(button, {
        offsetWidth: { value: 40 },
        offsetHeight: { value: 40 },
      });
      button.getBoundingClientRect = () => new DOMRect(0, 0, 40, 40);
      document.body.append(button);

      pointer(button.querySelector('span')!, 'pointerdown');

      expect(button.dataset.glassPress).toBe('round');
      expect(button.children).toHaveLength(1);

      pointer(button, 'pointerup');
      expect(button.hasAttribute('data-glass-press')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
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
    'releases on %s without scheduling cleanup',
    (event) => {
      const group = surface();
      const button = group.querySelector('button')!;
      pointer(button, 'pointerdown');
      pointer(button, event, event === 'pointermove' ? 400 : 20);
      expect(group.hasAttribute('data-glass-press')).toBe(false);
      expect(group.style.getPropertyValue('--press-fill')).toBe('');
      // The last position stays available to CSS while the sheen fades.
      expect(group.style.getPropertyValue('--press-x')).toBe('20px');
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it('keeps a rapid second press alive and disposes the active press', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    pointer(button, 'pointerdown');
    pointer(button, 'pointerup');
    vi.advanceTimersByTime(100);
    pointer(button, 'pointerdown', 120);
    vi.advanceTimersByTime(1000);
    expect(group.dataset.glassPress).toBe('wide');
    expect(group.style.getPropertyValue('--press-x')).toBe('120px');
    expect(vi.getTimerCount()).toBe(0);
    dispose();
    expect(group.hasAttribute('data-glass-press')).toBe(false);
    pointer(button, 'pointerdown');
    expect(group.hasAttribute('data-glass-press')).toBe(false);
  });
  it('does not strand a released surface when the next press has no layout', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    pointer(button, 'pointerdown');
    pointer(button, 'pointerup');
    group.getBoundingClientRect = () => new DOMRect();
    pointer(button, 'pointerdown');
    expect(group.hasAttribute('data-glass-press')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never snapshots styles or takes ownership of reactive children', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    const originalContent = group.innerHTML;
    const getStyle = vi.spyOn(window, 'getComputedStyle');
    pointer(button, 'pointerdown');
    expect(group.innerHTML).toBe(originalContent);
    button.replaceChildren();
    pointer(button, 'pointerup');
    pointer(button, 'pointerdown');
    expect(button.childNodes).toHaveLength(0);
    expect(group.children).toHaveLength(2);
    expect(getStyle).not.toHaveBeenCalled();
  });
  it('releases on window blur', () => {
    const group = surface();
    pointer(group.querySelector('button')!, 'pointerdown');
    window.dispatchEvent(new Event('blur'));
    expect(group.hasAttribute('data-glass-press')).toBe(false);
  });
});
