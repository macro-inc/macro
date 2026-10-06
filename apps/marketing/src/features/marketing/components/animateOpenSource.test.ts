import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateOpenSource } from './animateOpenSource';

let dispose = () => {};
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let effects: {
  currentTime: number;
  pause: () => void;
  cancel: ReturnType<typeof vi.fn>;
}[];
let reduced: MediaQueryList;
const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  effects = [];
  reduced = Object.assign(new EventTarget(), {
    matches: false,
  }) as MediaQueryList;
  vi.stubGlobal('matchMedia', () => reduced);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      const effect = { currentTime: 0, pause() {}, cancel: vi.fn() };
      effects.push(effect);
      return effect as unknown as Animation;
    }),
  });
});
afterEach(() => {
  dispose();
  dispose = () => {};
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

function setup() {
  const scroller = document.createElement('div');
  scroller.innerHTML = `<section class="homepage-unification"><div class="feature-flow"><div class="feature-flow-node"><div class="feature-flow-icon"><svg></svg></div></div></div></section><section class="homepage-open-source"><div class="homepage-github-mark"></div></section>`;
  document.body.append(scroller);
  const section = scroller.querySelector<HTMLElement>('.homepage-open-source')!;
  const scene = scroller.querySelector<HTMLElement>('.feature-flow')!;
  const node = scroller.querySelector<HTMLElement>('.feature-flow-node')!;
  const source = scroller.querySelector<HTMLElement>('.feature-flow-icon')!;
  const target = section.querySelector<HTMLElement>('.homepage-github-mark')!;
  Object.defineProperty(scroller, 'clientHeight', { value: 800 });
  Object.defineProperty(section, 'offsetWidth', { value: 400 });
  Object.defineProperty(scene, 'offsetWidth', { value: 400 });
  Object.defineProperties(node, {
    offsetLeft: { value: 100 },
    offsetTop: { value: 80 },
    offsetWidth: { value: 48 },
    offsetHeight: { value: 48 },
  });
  Object.defineProperties(source, {
    offsetWidth: { value: 48 },
    offsetHeight: { value: 48 },
  });
  Object.defineProperty(target, 'offsetHeight', { value: 100 });
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 400, 800)
  );
  vi.spyOn(section, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 1000 - scroller.scrollTop, 400, 600)
  );
  vi.spyOn(scene, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 600 - scroller.scrollTop, 400, 300)
  );
  vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(150, 1100 - scroller.scrollTop, 100, 100)
  );
  // The prior transition has transformed this bubble away from its rest position.
  vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(200, 200, 10, 10)
  );
  dispose = animateOpenSource(section, scroller);
  const scroll = (top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll'));
  };
  return { scroller, section, source, scroll };
}
function step() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(16));
}

describe('mobile bubble scroll transition', () => {
  it('prepares settled bubble geometry before the first gesture and batches scrolling', () => {
    const { section, source, scroll } = setup();
    expect(effects).toHaveLength(2);
    const overlay = section.querySelector<HTMLElement>(
      '.homepage-open-source-travel'
    )!;
    expect(overlay.hidden).toBe(true);
    expect(overlay.firstElementChild?.getAttribute('style')).toContain(
      'left: 76px'
    );
    expect(overlay.firstElementChild?.getAttribute('style')).toContain(
      'top: -344px'
    );
    expect(source.style.visibility).toBe('');
    scroll(400);
    step();
    expect(overlay.hidden).toBe(true);
    expect(source.style.visibility).toBe('');
    scroll(450);
    scroll(500);
    expect(frames.size).toBe(1);
    expect(effects[0].currentTime).toBe(0);
    step();
    expect(effects).toHaveLength(2);
    expect(effects[0].currentTime).toBeGreaterThan(0);
    expect(overlay.hidden).toBe(false);
    expect(source.style.visibility).toBe('hidden');
    scroll(0);
    step();
    expect(overlay.hidden).toBe(true);
    expect(source.style.visibility).toBe('');
    expect(effects[0].currentTime).toBe(0);
  });
  it('clamps finished effects and restores sources and pending work on disposal', () => {
    const { section, source, scroll } = setup();
    scroll(940);
    step();
    expect(effects[1].currentTime).toBe(1300);
    scroll(950);
    step();
    expect(effects[1].currentTime).toBe(1300);
    scroll(960);
    expect(frames.size).toBe(1);
    dispose();
    expect(frames.size).toBe(0);
    expect(source.style.visibility).toBe('');
    expect(section.querySelector('.homepage-open-source-travel')).toBeNull();
    expect(
      effects.every((effect) => effect.cancel.mock.calls.length === 1)
    ).toBe(true);
    dispose = () => {};
  });
  it('shows the finished state without preparing travel effects for reduced motion', () => {
    Object.defineProperty(reduced, 'matches', { value: true });
    const { section, source, scroll } = setup();
    scroll(500);
    step();
    expect(effects).toHaveLength(0);
    expect(section.querySelector('.homepage-open-source-travel')).toBeNull();
    expect(source.style.visibility).toBe('');
  });
});
