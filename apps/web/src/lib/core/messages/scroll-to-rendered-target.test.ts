import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollToRenderedTarget } from './scroll-to-rendered-target';

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  scrollIntoView.mockReset();
  document.body.innerHTML = '';
});

const flushMutations = () => Promise.resolve();

function renderTarget(root: HTMLElement, id: string) {
  const target = document.createElement('div');
  target.dataset.messageId = id;
  root.append(target);
  return target;
}

describe('scrollToRenderedTarget', () => {
  it('scrolls a target that is already rendered', () => {
    const onSettled = vi.fn();
    const root = document.body.appendChild(document.createElement('div'));
    const target = renderTarget(root, 'm1');

    const cancel = scrollToRenderedTarget(root, 'm1', { onSettled });

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
    expect(onSettled).toHaveBeenCalledOnce();
    cancel();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('waits for the target to render, then scrolls once', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    scrollToRenderedTarget(root, 'm1');
    expect(scrollIntoView).not.toHaveBeenCalled();

    renderTarget(root, 'other');
    await flushMutations();
    expect(scrollIntoView).not.toHaveBeenCalled();

    renderTarget(root, 'm1');
    await flushMutations();
    renderTarget(root, 'later');
    await flushMutations();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('never scrolls after the user starts scrolling', async () => {
    const onSettled = vi.fn();
    const root = document.body.appendChild(document.createElement('div'));
    scrollToRenderedTarget(root, 'm1', { onSettled });

    window.dispatchEvent(new WheelEvent('wheel'));
    renderTarget(root, 'm1');
    await flushMutations();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('gives up after the timeout', async () => {
    const onSettled = vi.fn();
    const root = document.body.appendChild(document.createElement('div'));
    scrollToRenderedTarget(root, 'm1', {
      timeoutMs: 100,
      onSettled,
    });

    vi.advanceTimersByTime(100);
    renderTarget(root, 'm1');
    await flushMutations();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('matches an id with selector metacharacters literally', () => {
    const root = document.body.appendChild(document.createElement('div'));
    renderTarget(root, 'm1');
    const target = renderTarget(root, 'm1"], [data-message-id="m1');

    expect(() =>
      scrollToRenderedTarget(root, 'm1"], [data-message-id="m1')
    ).not.toThrow();
    expect(scrollIntoView.mock.contexts).toEqual([target]);
  });

  it('stops waiting when cancelled', async () => {
    const onSettled = vi.fn();
    const root = document.body.appendChild(document.createElement('div'));
    const cancel = scrollToRenderedTarget(root, 'm1', { onSettled });

    cancel();
    renderTarget(root, 'm1');
    await flushMutations();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('finishes an interrupted scroll after the document reflows, then leaves refreshes alone', () => {
    let resized: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const viewport = document.body.appendChild(document.createElement('div'));
    viewport.style.overflowY = 'auto';
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    const root = viewport.appendChild(document.createElement('div'));
    const target = renderTarget(root, 'm1');
    let top = 2000;
    target.getBoundingClientRect = () => new DOMRect(0, top, 600, 100);

    scrollToRenderedTarget(root, 'm1');
    expect(scrollIntoView).toHaveBeenCalledOnce();

    // Layout interrupts the native animation before the comment is visible.
    top = 1200;
    viewport.dispatchEvent(new Event('scrollend'));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    // A resize notification with unchanged geometry must not restart motion.
    resized();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    top = 1400;
    resized();
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    top = 150;
    viewport.dispatchEvent(new Event('scrollend'));
    expect(disconnect).toHaveBeenCalledOnce();

    top = 1600;
    resized();
    viewport.dispatchEvent(new Event('scrollend'));
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it.each(['wheel', 'touchmove', 'keydown', 'pointerdown'])(
    'does not retry an interrupted animation after %s',
    (type) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        }
      );
      const viewport = document.body.appendChild(document.createElement('div'));
      viewport.style.overflowY = 'auto';
      viewport.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
      const target = renderTarget(viewport, 'm1');
      target.getBoundingClientRect = () => new DOMRect(0, 2000, 600, 100);

      scrollToRenderedTarget(viewport, 'm1');
      window.dispatchEvent(new Event(type));
      viewport.dispatchEvent(new Event('scrollend'));
      expect(scrollIntoView).toHaveBeenCalledOnce();
    }
  );
});
