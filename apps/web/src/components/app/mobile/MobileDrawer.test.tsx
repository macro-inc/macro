import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scrollToFocusedInput } from './MobileDrawer';

vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  cleanup();
  vi.useRealTimers();
});

it('does not scroll an old input after focus moves to a menu', () => {
  const scrollTo = vi.fn();
  render(() => (
    <div
      data-drawer-scroll-body
      ref={(element) => {
        element.scrollTo = scrollTo;
      }}
      onFocusIn={scrollToFocusedInput}
    >
      <input aria-label="Title" />
      <button>Menu</button>
    </div>
  ));
  screen.getByRole('textbox').focus();
  screen.getByRole('button').focus();
  vi.advanceTimersByTime(300);
  expect(scrollTo).not.toHaveBeenCalled();
});

it('keeps the keyboard adjustment while the input retains focus', () => {
  const scrollTo = vi.fn();
  render(() => (
    <div
      data-drawer-scroll-body
      ref={(element) => {
        element.scrollTo = scrollTo;
      }}
      onFocusIn={scrollToFocusedInput}
    >
      <input aria-label="Title" />
    </div>
  ));
  screen.getByRole('textbox').focus();
  vi.advanceTimersByTime(300);
  expect(scrollTo).toHaveBeenCalledOnce();
});
