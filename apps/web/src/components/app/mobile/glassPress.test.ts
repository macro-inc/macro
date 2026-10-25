import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({ platform: 'ios', touch: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => device.platform === platform,
}));

import { glassPressGeometry, installGlassPress } from './glassPress';

let dispose: () => void;
function pointer(element: Element, type: string, x = 20, y = 20) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
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
  return event;
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
  device.platform = 'ios';
  device.touch = true;
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
  it('grows round controls by 28% and caps wide displacement independently of width', () => {
    expect(glassPressGeometry(46, 46).round).toBe(true);
    expect(glassPressGeometry(46, 46).scale).toBeCloseTo(1.28);
    expect(glassPressGeometry(300, 46).outset).toBe(6);
    expect(glassPressGeometry(600, 46).outset).toBe(6);
    expect(glassPressGeometry(600, 80).outset).toBe(6);
  });
  it.each(['android', 'web', 'desktop'])(
    'leaves %s controls without the iOS press effect',
    (platform) => {
      device.platform = platform;
      const group = surface();
      const event = pointer(group.querySelector('button')!, 'pointerdown');
      expect(group.hasAttribute('data-glass-press')).toBe(false);
      expect(group.style.getPropertyValue('--press-x')).toBe('');
      expect(event.defaultPrevented).toBe(false);
    }
  );
  it('leaves non-touch input unchanged', () => {
    device.touch = false;
    const group = surface();
    pointer(group.querySelector('button')!, 'pointerdown');
    expect(group.hasAttribute('data-glass-press')).toBe(false);
  });
  it.each([140, 480])(
    'lights a %ipx-tall channel editor without scaling its text or disturbing its draft',
    (height) => {
      const group = surface(360, height);
      group.removeAttribute('data-mobile-dock-island');
      group.dataset.glassInput = '';
      group.innerHTML =
        '<div contenteditable="true" role="textbox">Unsent draft</div><button>Add</button>';
      const editor = group.querySelector<HTMLElement>('[contenteditable]')!;
      editor.focus();
      const event = pointer(editor, 'pointerdown', 160, 40);
      expect(group.dataset.glassPress).toBe('wide');
      expect(group.style.getPropertyValue('--press-x')).toBe('160px');
      expect(group.style.getPropertyValue('--press-y')).toBe('40px');
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(editor);
      expect(editor.textContent).toBe('Unsent draft');
      pointer(editor, 'pointercancel');
      expect(group.hasAttribute('data-glass-press')).toBe(false);
      expect(document.activeElement).toBe(editor);
    }
  );
  it('lights the collapsed channel input when its preview is pressed', () => {
    const root = document.createElement('div');
    root.dataset.input = '';
    document.body.append(root);
    const group = surface();
    group.removeAttribute('data-mobile-dock-island');
    group.dataset.composerCollapsed = '';
    root.append(group);
    pointer(group.querySelector('button')!, 'pointerdown');
    expect(group.dataset.glassPress).toBe('wide');
    pointer(group, 'pointerup');
    expect(group.hasAttribute('data-glass-press')).toBe(false);
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
  it('follows the latest touch once per frame without reading layout on each move', () => {
    const group = surface();
    const button = group.querySelector('button')!;
    const bounds = vi.spyOn(group, 'getBoundingClientRect');
    pointer(button, 'pointerdown');
    bounds.mockClear();

    pointer(button, 'pointermove', 80, 25);
    pointer(button, 'pointermove', 180, 30);
    expect(group.style.getPropertyValue('--press-x')).toBe('20px');
    expect(bounds).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersToNextFrame();
    expect(group.style.getPropertyValue('--press-x')).toBe('180px');
    expect(group.style.getPropertyValue('--press-y')).toBe('30px');
    expect(bounds).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(group.children).toHaveLength(2);
  });
  it('tracks local coordinates as a round surface expands', () => {
    const group = surface(46, 46);
    const button = group.querySelector('button')!;
    pointer(button, 'pointerdown', 23, 23);
    group.getBoundingClientRect = () => new DOMRect(-6.44, -6.44, 58.88, 58.88);
    pointer(button, 'pointermove', 35, 30);
    vi.advanceTimersToNextFrame();
    expect(parseFloat(group.style.getPropertyValue('--press-x'))).toBeCloseTo(
      32.375
    );
    expect(parseFloat(group.style.getPropertyValue('--press-y'))).toBeCloseTo(
      28.46875
    );
  });
  it.each(['pointerup', 'pointercancel', 'outside', 'blur', 'dispose'])(
    'cancels a queued spotlight update on %s',
    (end) => {
      const group = surface();
      const button = group.querySelector('button')!;
      pointer(button, 'pointerdown');
      pointer(button, 'pointermove', 180);
      if (end === 'dispose') dispose();
      else if (end === 'blur') window.dispatchEvent(new Event('blur'));
      else if (end === 'outside') pointer(button, 'pointermove', 400);
      else pointer(button, end);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersToNextFrame();
      expect(group.hasAttribute('data-glass-press')).toBe(false);
      expect(group.style.getPropertyValue('--press-x')).toBe('20px');
    }
  );
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
