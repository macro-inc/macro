/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollapseTransition } from './CollapseTransition';

type TestAnimation = {
  frames: Keyframe[];
  onfinish: (() => void) | null;
  cancel: () => void;
};

const animations: TestAnimation[] = [];
const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'animate'
);

beforeEach(() => {
  animations.length = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn((frames: Keyframe[]) => {
      const animation: TestAnimation = {
        frames,
        onfinish: null,
        cancel: vi.fn(),
      };
      animations.push(animation);
      return animation;
    }),
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function () {
      return new DOMRect(0, 0, 200, 120);
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  }
});

it('keeps closing content mounted and inert until the height animation finishes', () => {
  const [open, setOpen] = createSignal(true);
  const view = render(() => (
    <CollapseTransition open={open()}>
      <div>Section rows</div>
    </CollapseTransition>
  ));
  const rows = view.getByText('Section rows');

  setOpen(false);

  expect(rows.isConnected).toBe(true);
  expect(rows.inert).toBe(true);
  expect(animations[0].frames.map((frame) => frame.height)).toEqual([
    '120px',
    '0px',
  ]);
  expect(animations[1].frames.map((frame) => frame.opacity)).toEqual(['1', 0]);
  animations[0].onfinish?.();
  expect(rows.isConnected).toBe(false);
});

it('finishes an interrupted close without removing the reopened content', async () => {
  const [open, setOpen] = createSignal(true);
  const view = render(() => (
    <CollapseTransition open={open()}>
      <div>Section rows</div>
    </CollapseTransition>
  ));

  setOpen(false);
  const closing = animations[0];
  setOpen(true);
  await waitFor(() => expect(animations.length).toBe(4));
  closing.onfinish?.();
  animations[2].onfinish?.();

  expect(view.getAllByText('Section rows')).toHaveLength(1);
  expect(view.getByText('Section rows').inert).toBe(false);
  expect(closing.cancel).toHaveBeenCalled();
});

it('skips motion and removes content immediately with reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const [open, setOpen] = createSignal(true);
  const view = render(() => (
    <CollapseTransition open={open()}>
      <div>Section rows</div>
    </CollapseTransition>
  ));

  setOpen(false);

  expect(view.queryByText('Section rows')).toBeNull();
  expect(animations).toHaveLength(0);
});
