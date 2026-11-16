import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileProjectDescription } from './project-description';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
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
});

it('refits the preview after resize without losing the expanded editor', () => {
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

it('leaves the empty placeholder unclamped across local or collaborative content changes', async () => {
  const [empty, setEmpty] = createSignal(true);
  const view = render(() => (
    <MobileProjectDescription availableHeight={144}>
      <div>
        <div class="relative">
          <div
            role="textbox"
            ref={(element) => {
              Object.defineProperty(element, 'scrollHeight', {
                get: () => (empty() ? 24 : 300),
              });
            }}
          >
            <Show when={!empty()}>A long description</Show>
          </div>
          <Show when={empty()}>
            <div class="pointer-events-none text-ink-placeholder absolute top-0">
              Add a description. Use commands or mention a project member.
            </div>
          </Show>
        </div>
      </div>
    </MobileProjectDescription>
  ));
  const editor = screen.getByRole('textbox');
  const clamp = view.container.firstElementChild?.firstElementChild;
  expect(clamp?.classList.contains('overflow-hidden')).toBe(false);
  expect(screen.queryByRole('button')).toBeNull();
  // The absolute editor placeholder must occupy space above Discussion too.
  expect(clamp?.firstElementChild?.className).toContain(
    '[&_[role=textbox]~.text-ink-placeholder]:static'
  );
  setEmpty(false);
  await Promise.resolve();
  expect(clamp?.classList.contains('overflow-hidden')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
  setEmpty(true);
  await Promise.resolve();
  expect(clamp?.classList.contains('overflow-hidden')).toBe(false);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('textbox')).toBe(editor);
});
