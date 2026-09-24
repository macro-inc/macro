import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollToRenderedTarget } from './scroll-to-rendered-target';

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
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
    const root = document.body.appendChild(document.createElement('div'));
    const target = renderTarget(root, 'm1');

    scrollToRenderedTarget(root, 'm1');

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
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
    const root = document.body.appendChild(document.createElement('div'));
    scrollToRenderedTarget(root, 'm1');

    window.dispatchEvent(new WheelEvent('wheel'));
    renderTarget(root, 'm1');
    await flushMutations();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('gives up after the timeout', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    scrollToRenderedTarget(root, 'm1', {
      timeoutMs: 100,
    });

    vi.advanceTimersByTime(100);
    renderTarget(root, 'm1');
    await flushMutations();

    expect(scrollIntoView).not.toHaveBeenCalled();
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
    const root = document.body.appendChild(document.createElement('div'));
    const cancel = scrollToRenderedTarget(root, 'm1');

    cancel();
    renderTarget(root, 'm1');
    await flushMutations();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
