import { createRoot } from 'solid-js';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { createContentPresentation } from '../content-presentation';
import type { SplitId } from '../layoutManager';

const OWNER = 'destination-pane' as SplitId;
const FRAMES = new Map<number, FrameRequestCallback>();

function setup() {
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    FRAMES.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => FRAMES.delete(id));
  const presentation = createRoot((dispose) => {
    onTestFinished(dispose);
    return createContentPresentation();
  });
  const element = document.createElement('div');
  document.body.append(element);
  onTestFinished(() => element.remove());
  vi.spyOn(element, 'getClientRects').mockReturnValue({
    0: new DOMRect(0, 0, 420, 900),
    length: 1,
    item: () => null,
    [Symbol.iterator]() {
      return [new DOMRect(0, 0, 420, 900)][Symbol.iterator]();
    },
  });
  return { presentation, element };
}

function draw() {
  const callbacks = [...FRAMES.values()];
  FRAMES.clear();
  for (const callback of callbacks) callback(0);
}

afterEach(() => {
  FRAMES.clear();
  vi.unstubAllGlobals();
});

it('waits for the matching active route shell before completing an open', () => {
  const { presentation, element } = setup();
  const complete = vi.fn();
  presentation.prepare(complete)(OWNER, 'new-entry');
  draw();
  expect(complete).not.toHaveBeenCalled();
  const unregisterOld = presentation.register(OWNER, 'old-entry', element);
  draw();
  expect(complete).not.toHaveBeenCalled();
  unregisterOld();
  presentation.register(OWNER, 'new-entry', element);
  draw();
  expect(complete).toHaveBeenCalledOnce();
  expect(presentation.pending()).toBeUndefined();
});

it('does not acknowledge an old open or a detached destination after a newer request', () => {
  const { presentation, element } = setup();
  const oldComplete = vi.fn();
  const oldOpen = presentation.prepare(oldComplete);
  const complete = vi.fn();
  const newOpen = presentation.prepare(complete);
  oldOpen(OWNER, 'old-entry');
  expect(presentation.pending()).toBeUndefined();
  newOpen(OWNER, 'new-entry');
  const unregister = presentation.register(OWNER, 'new-entry', element);
  unregister();
  draw();
  expect(complete).not.toHaveBeenCalled();
  expect(oldComplete).not.toHaveBeenCalled();
  presentation.register(OWNER, 'new-entry', element);
  draw();
  expect(complete).toHaveBeenCalledOnce();
});
