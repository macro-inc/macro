/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scroll } from '../../../components/ui/components/Scroll';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Markdown scroll viewport', () => {
  it('exposes the element that owns vertical scrolling', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const setScrollRef = vi.fn<(element: HTMLDivElement) => void>();

    const { container } = render(() => (
      <Scroll scrollRef={setScrollRef}>Content</Scroll>
    ));

    expect(setScrollRef).toHaveBeenCalledOnce();
    const viewport = setScrollRef.mock.calls[0]?.[0];
    expect(viewport?.style.overflowY).toBe('auto');
    expect(viewport?.parentElement).toBe(container.firstElementChild);
  });
});
