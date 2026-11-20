// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScrollIndicators } from './VerticalScrollIndicators';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows only the scroll edges that contain hidden content with the shared mobile falloff', () => {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientHeight', { value: 100 });
  Object.defineProperty(viewport, 'scrollHeight', { value: 300 });
  const result = render(() => (
    <ScrollIndicators
      scrollRef={() => viewport}
      appearance="gradient"
      gradientColor="menu"
      falloff="mobile"
    />
  ));
  const [top, bottom] =
    result.container.querySelectorAll<HTMLElement>('[aria-hidden]');
  expect(top.style.opacity).toBe('0');
  expect(bottom.style.opacity).toBe('1');
  expect(top.style.height).toBe('32px');
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  expect(top.style.opacity).toBe('1');
  expect(bottom.style.opacity).toBe('1');
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  expect(bottom.style.opacity).toBe('0');
});
