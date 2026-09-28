import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScrollLifecycle } from '../create-scroll-lifecycle';

afterEach(() => vi.useRealTimers());

describe('initial scroll lifecycle', () => {
  it.each(['navigate', 'user-scroll', 'dispose'] as const)(
    '%s permanently cancels a pending element fallback',
    (event) => {
      vi.useFakeTimers();
      createRoot((dispose) => {
        const positionFallback = vi.fn();
        const lifecycle = createScrollLifecycle({
          hasLayout: () => true,
          waitForElement: true,
          positionInitial: vi.fn(),
          positionFallback,
          onReady: vi.fn(),
        });
        lifecycle.send('layout');
        lifecycle.send(event);
        vi.advanceTimersByTime(2000);
        lifecycle.send('layout');
        expect(positionFallback).not.toHaveBeenCalled();
        dispose();
      });
    }
  );
});
