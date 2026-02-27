import { describe, expect, it } from 'vitest';
import { shouldShowScrollToBottomButton } from '../ScrollToBottomOverlay';

describe('shouldShowScrollToBottomButton', () => {
  it('shows only when initial scroll is done, scrolled away, and user scrolls down', () => {
    expect(
      shouldShowScrollToBottomButton({
        didInitialScroll: true,
        isNearBottom: false,
        isScrollingDown: true,
        distanceFromTop: 1200,
        distanceFromBottom: 1800,
        viewportSize: 900,
      })
    ).toBe(true);
  });

  it('hides when near bottom', () => {
    expect(
      shouldShowScrollToBottomButton({
        didInitialScroll: true,
        isNearBottom: true,
        isScrollingDown: true,
        distanceFromTop: 1200,
        distanceFromBottom: 10,
        viewportSize: 900,
      })
    ).toBe(false);
  });

  it('hides when not scrolling down', () => {
    expect(
      shouldShowScrollToBottomButton({
        didInitialScroll: true,
        isNearBottom: false,
        isScrollingDown: false,
        distanceFromTop: 1200,
        distanceFromBottom: 1800,
        viewportSize: 900,
      })
    ).toBe(false);
  });

  it('hides when not past one page from bottom', () => {
    expect(
      shouldShowScrollToBottomButton({
        didInitialScroll: true,
        isNearBottom: false,
        isScrollingDown: true,
        distanceFromTop: 200,
        distanceFromBottom: 300,
        viewportSize: 900,
      })
    ).toBe(false);
  });
});
