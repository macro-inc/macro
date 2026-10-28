import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installIconMotion } from './icon-motion';

let dispose: () => void;
let reduced = false;
let preferenceChange: () => void;
const animate = vi.fn();
const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);

function control(name = 'gear', attributes = '') {
  const button = document.createElement('button');
  button.innerHTML = `<svg data-macro-icon="${name}" ${attributes}></svg>`;
  document.body.append(button);
  return button;
}

function pointer(target: Element, type = 'pointerdown', extra = {}) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    ...extra,
  });
  target.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('reduced-motion') ? reduced : true;
    },
    addEventListener: (_: string, callback: () => void) => {
      preferenceChange = callback;
    },
    removeEventListener: vi.fn(),
  }));
  animate.mockReset().mockImplementation(() => ({
    cancel: vi.fn(),
    onfinish: null,
    oncancel: null,
  }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 20,
    height: 20,
  } as DOMRect);
  dispose = installIconMotion();
});

afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('animates a dynamically mounted action once on pointer activation', () => {
  const button = control();
  pointer(button.querySelector('svg')!);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.calls[0][0][1].rotate).toBe('24deg');
  expect(animate.mock.calls[0][1].duration).toBe(320);
});

it('also responds to keyboard and assistive-technology activation', () => {
  control('share').click();
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.calls[0][0][1].translate).toBe('0 -2px');
});

it('animates the shared wrapper once for stacked navigation variants', () => {
  const button = control();
  button.innerHTML =
    '<span data-icon-motion-target><svg data-macro-icon="gear"></svg><svg data-macro-icon="gear-fill"></svg></span>';
  pointer(button);
  expect(animate.mock.contexts).toEqual([button.firstElementChild]);
});

it('leaves static, disabled, opted-out, state, and busy icons still', () => {
  const staticIcon = document.createElement('div');
  staticIcon.innerHTML = '<svg data-macro-icon="gear"></svg>';
  document.body.append(staticIcon);
  pointer(staticIcon.firstElementChild!);
  const disabled = control();
  disabled.disabled = true;
  pointer(disabled);
  const ariaDisabled = control();
  ariaDisabled.setAttribute('aria-disabled', 'true');
  pointer(ariaDisabled);
  pointer(control('gear', 'data-icon-motion="none"'));
  pointer(control('caret-down'));
  pointer(control('spinner'));
  pointer(control('gear', 'class="animate-spin"'));
  expect(animate).not.toHaveBeenCalled();
});

it('does not animate a nested action when its enclosing control is pressed', () => {
  const outer = document.createElement('div');
  outer.setAttribute('role', 'button');
  document.body.append(outer);
  const inner = control();
  outer.append(inner);
  pointer(outer);
  expect(animate).not.toHaveBeenCalled();
  pointer(inner);
  expect(animate).toHaveBeenCalledTimes(1);
});

it('skips large illustrative icons and secondary mouse buttons', () => {
  const button = control();
  pointer(button, 'pointerdown', { button: 2 });
  vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({
    width: 48,
    height: 48,
  } as DOMRect);
  pointer(button);
  expect(animate).not.toHaveBeenCalled();
});

it('cancels the previous motion instead of stacking repeated presses', () => {
  const button = control();
  pointer(button);
  const first = animate.mock.results[0].value;
  pointer(button);
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalledTimes(2);
});

it('waits for hover intent and cancels on leave or press', () => {
  const button = control();
  pointer(button, 'pointerover');
  vi.advanceTimersByTime(100);
  expect(animate).not.toHaveBeenCalled();
  pointer(button, 'pointerout');
  vi.advanceTimersByTime(200);
  expect(animate).not.toHaveBeenCalled();
  pointer(button, 'pointerover');
  vi.advanceTimersByTime(160);
  expect(animate.mock.calls[0][1].duration).toBe(280);
  pointer(button, 'pointerover');
  pointer(button);
  vi.advanceTimersByTime(200);
  expect(animate).toHaveBeenCalledTimes(2);
});

it('limits hover to suitable icons and ignores touch hover', () => {
  pointer(control('folder'), 'pointerover');
  vi.advanceTimersByTime(200);
  pointer(control(), 'pointerover', { pointerType: 'touch' });
  vi.advanceTimersByTime(200);
  expect(animate).not.toHaveBeenCalled();
});

it('respects reduced motion immediately and cancels active animations on change', () => {
  const button = control();
  pointer(button);
  reduced = true;
  preferenceChange();
  expect(animate.mock.results[0].value.cancel).toHaveBeenCalledOnce();
  pointer(button);
  button.click();
  pointer(button, 'pointerover');
  vi.advanceTimersByTime(200);
  expect(animate).toHaveBeenCalledTimes(1);
});

it('removes listeners, pending hovers, and active animations on cleanup', () => {
  const button = control();
  pointer(button);
  pointer(button, 'pointerover');
  dispose();
  expect(animate.mock.results[0].value.cancel).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(200);
  pointer(button);
  button.click();
  expect(animate).toHaveBeenCalledTimes(1);
});

it('covers command-palette options inserted after installation', () => {
  const option = document.createElement('div');
  option.setAttribute('role', 'option');
  option.innerHTML = '<svg data-macro-icon="terminal"></svg>';
  document.body.append(option);
  pointer(option);
  expect(animate).toHaveBeenCalledOnce();
});
