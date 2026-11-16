import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileProjectDescription } from './project-description';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('refits the preview after resize without losing the expanded editor', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const getStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = getStyle(element);
    Object.defineProperty(style, 'lineHeight', { value: '24px' });
    return style;
  });
  const [height, setHeight] = createSignal(216);
  const view = render(() => (
    <MobileProjectDescription availableHeight={height()}>
      <div
        role="textbox"
        ref={(element) => {
          Object.defineProperty(element, 'scrollHeight', { value: 240 });
        }}
      >
        Project description
      </div>
    </MobileProjectDescription>
  ));
  const editor = screen.getByRole('textbox');
  const container = view.container.firstElementChild;
  expect(container?.getAttribute('style')).toContain('--description-lines: 8');
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  setHeight(144);
  expect(container?.getAttribute('style')).toContain('--description-lines: 5');
  expect(
    screen
      .getByRole('button', { name: 'Show less' })
      .getAttribute('aria-expanded')
  ).toBe('true');
  expect(screen.getByRole('textbox')).toBe(editor);
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  setHeight(192);
  expect(container?.getAttribute('style')).toContain('--description-lines: 7');
  expect(screen.getByRole('textbox')).toBe(editor);
});
