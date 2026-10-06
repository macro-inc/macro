import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeRenderedAnswer } from './render-telemetry';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) =>
    setTimeout(callback, 16)
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 10, 300, 30)
  );
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function observe(html: string) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.append(element);
  const callbacks = {
    readable: vi.fn(),
    painted: vi.fn(),
    hidden: vi.fn(),
  };
  const stop = observeRenderedAnswer(element, callbacks);
  cleanups.push(stop);
  return { element, callbacks, stop };
}

describe('rendered answer telemetry', () => {
  it.each(['**', '1. **', '```'])(
    'waits past the bare prefix %s until words render',
    async (prefix) => {
      const { element, callbacks } = observe(prefix);
      vi.advanceTimersByTime(32);
      expect(callbacks.readable).not.toHaveBeenCalled();
      expect(callbacks.painted).not.toHaveBeenCalled();
      element.textContent = 'The sky is blue';
      await Promise.resolve();
      expect(callbacks.readable).toHaveBeenCalledOnce();
      expect(callbacks.painted).not.toHaveBeenCalled();
      vi.advanceTimersByTime(32);
      expect(callbacks.painted).toHaveBeenCalledOnce();
    }
  );

  it('does not count code language and copy controls before the code arrives', async () => {
    const { element, callbacks } = observe(
      '<div class="md-static-code-container"><div>JavaScript<button>Copy</button></div><pre></pre></div>'
    );
    vi.advanceTimersByTime(32);
    expect(callbacks.painted).not.toHaveBeenCalled();
    element.querySelector('pre')!.textContent = 'const answer = 42;';
    await Promise.resolve();
    vi.advanceTimersByTime(32);
    expect(callbacks.painted).toHaveBeenCalledOnce();
  });

  it.each(['42', '你好', 'مرحبا'])(
    'counts readable answers including %s',
    (text) => {
      const { callbacks } = observe(text);
      vi.advanceTimersByTime(32);
      expect(callbacks.painted).toHaveBeenCalledOnce();
    }
  );

  it('rejects CSS-hidden answer text even when its container is visible', () => {
    const { callbacks } = observe('<span style="display:none">Hello</span>');
    vi.advanceTimersByTime(32);
    expect(callbacks.painted).not.toHaveBeenCalled();
  });

  it('does not report a paint when navigation disconnects the text between frames', () => {
    const { element, callbacks } = observe('Hello');
    vi.advanceTimersByTime(16);
    element.remove();
    vi.advanceTimersByTime(16);
    expect(callbacks.painted).not.toHaveBeenCalled();
  });

  it('waits for an intersection so clipped transcript text is not counted', () => {
    let intersect!: (target: Element, visible: boolean) => void;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = (target, isIntersecting) =>
            callback(
              [{ target, isIntersecting } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver
            );
        }
        observe() {}
        disconnect() {}
      }
    );
    const { element, callbacks } = observe('Hello');
    intersect(element, false);
    vi.advanceTimersByTime(32);
    expect(callbacks.painted).not.toHaveBeenCalled();
    intersect(element, true);
    vi.advanceTimersByTime(32);
    expect(callbacks.painted).toHaveBeenCalledOnce();
  });

  it('reports a hidden tab without a visible success', () => {
    const { callbacks } = observe('Hello');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(32);
    expect(callbacks.hidden).toHaveBeenCalled();
    expect(callbacks.painted).not.toHaveBeenCalled();
  });

  it('cancels pending frames and DOM observation on cleanup', async () => {
    const { element, callbacks, stop } = observe('Hello');
    stop();
    element.textContent = 'More words';
    await Promise.resolve();
    vi.advanceTimersByTime(32);
    expect(callbacks.painted).not.toHaveBeenCalled();
    expect(callbacks.readable).toHaveBeenCalledOnce();
  });
});
