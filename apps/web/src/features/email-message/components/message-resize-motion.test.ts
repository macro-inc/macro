import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMessageResizeMotion } from './message-resize-motion';

let resize: (rect: { width: number; height: number }) => void;
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: (_target: unknown, callback: typeof resize) => {
    resize = callback;
  },
}));

afterEach(() => vi.unstubAllGlobals());

function setup(reducedMotion = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
  const card = document.createElement('div');
  const content = document.createElement('div');
  card.style.padding = '16px';
  card.style.border = '0px solid';
  card.append(content);
  const rect = vi.spyOn(card, 'getBoundingClientRect');
  const animations: Array<{
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
  }> = [];
  const animate = vi.fn(
    (_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
      const animation = {
        cancel: vi.fn(),
        onfinish: null as (() => void) | null,
      };
      animations.push(animation);
      return animation;
    }
  );
  Object.defineProperty(card, 'animate', { value: animate });
  const dispose = createRoot((dispose) => {
    const motion = createMessageResizeMotion();
    motion.setCard(card);
    motion.setContent(content);
    return dispose;
  });
  resize({ width: 500, height: 40 });
  return { animate, animations, rect, dispose };
}

it('continues a reversed transition from the visible height and releases sizing at rest', () => {
  const state = setup();
  resize({ width: 500, height: 240 });
  expect(state.animate.mock.calls[0]?.[0]).toEqual([
    { height: '72px', overflow: 'clip', boxSizing: 'border-box' },
    { height: '272px', overflow: 'clip', boxSizing: 'border-box' },
  ]);
  state.rect.mockReturnValue(new DOMRect(0, 0, 500, 150));
  resize({ width: 500, height: 40 });
  expect(state.animations[0].cancel).toHaveBeenCalledOnce();
  expect(state.animate.mock.calls[1]?.[0]).toEqual([
    { height: '150px', overflow: 'clip', boxSizing: 'border-box' },
    { height: '72px', overflow: 'clip', boxSizing: 'border-box' },
  ]);
  state.animations[1].onfinish?.();
  expect(state.animations[1].cancel).toHaveBeenCalledOnce();
  state.dispose();
});

it('settles active motion when the viewport width changes', () => {
  const state = setup();
  resize({ width: 500, height: 240 });
  resize({ width: 300, height: 240 });
  expect(state.animations[0].cancel).toHaveBeenCalledOnce();
  expect(state.animate).toHaveBeenCalledOnce();
  state.dispose();
});

it('skips motion for reduced motion and cancels it on unmount', () => {
  const reduced = setup(true);
  resize({ width: 500, height: 240 });
  expect(reduced.animate).not.toHaveBeenCalled();
  reduced.dispose();
  const active = setup();
  resize({ width: 500, height: 240 });
  active.dispose();
  expect(active.animations[0].cancel).toHaveBeenCalledOnce();
});
