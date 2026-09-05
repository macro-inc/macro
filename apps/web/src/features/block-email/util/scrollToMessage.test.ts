// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  adjustScrollAfterPrepend,
  alignmentDelta,
  fetchOlderMessages,
  hiddenMessagesControl,
  isTruncatedMiddleMessage,
  keyboardRevealDelta,
  leadingThrottle,
  listNeedsOlderPage,
  listScrollBehavior,
  nearestDelta,
  pageThenAdvanceDelta,
  revealDelta,
  scrollToListEndDelta,
  scrollToListStartDelta,
  threadMessageIsExpanded,
  truncatedMiddleCount,
} from './scrollToMessage';

function box(element: HTMLElement, top: number, bottom: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON() {
      return {};
    },
  });
}

describe('isTruncatedMiddleMessage', () => {
  it('hides only the middle when there are more than three messages', () => {
    expect(truncatedMiddleCount(3)).toBe(0);
    expect(truncatedMiddleCount(6)).toBe(3);
    expect(isTruncatedMiddleMessage(0, 6)).toBe(false);
    expect(isTruncatedMiddleMessage(1, 6)).toBe(true);
    expect(isTruncatedMiddleMessage(3, 6)).toBe(true);
    expect(isTruncatedMiddleMessage(4, 6)).toBe(false);
    expect(isTruncatedMiddleMessage(5, 6)).toBe(false);
  });
});

describe('hiddenMessagesControl', () => {
  it('finds the expand control in the list', () => {
    const list = document.createElement('div');
    const button = document.createElement('button');
    button.setAttribute('data-hidden-messages', '');
    list.append(button);
    expect(hiddenMessagesControl(list)).toBe(button);
  });
});

describe('threadMessageIsExpanded', () => {
  it('opens the newest message and unread, draft, or manual cards', () => {
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 2,
        listLength: 3,
        isUnread: false,
        hasDraft: false,
      })
    ).toBe(true);
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 0,
        listLength: 3,
        isUnread: true,
        hasDraft: false,
      })
    ).toBe(true);
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 1,
        listLength: 3,
        isUnread: false,
        hasDraft: false,
      })
    ).toBe(false);
  });

  it('lets an explicit collapse win over newest or unread', () => {
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 2,
        listLength: 3,
        expansionOverride: false,
        isUnread: false,
        hasDraft: false,
      })
    ).toBe(false);
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 0,
        listLength: 3,
        expansionOverride: false,
        isUnread: true,
        hasDraft: false,
      })
    ).toBe(false);
  });
});

describe('alignmentDelta', () => {
  it('start-aligns the card to the list top', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 175, 800);
    box(element, 175, 400);
    expect(alignmentDelta(container, element, 'start')).toBe(0);
    box(element, 200, 400);
    expect(alignmentDelta(container, element, 'start')).toBe(25);
  });

  it('respects scroll-padding on the list container', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    container.style.scrollPaddingTop = '8px';
    box(container, 0, 800);
    box(element, 0, 200);
    expect(alignmentDelta(container, element, 'start')).toBe(-8);
  });

  it('end-aligns the card to the list bottom', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 600, 800);
    expect(alignmentDelta(container, element, 'end')).toBe(0);
  });
});

describe('revealDelta', () => {
  it('does nothing when the card already fits', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 200, 400);
    expect(revealDelta(container, element)).toBe(0);
  });

  it('scrolls down when the card grows past the bottom', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 600, 950);
    expect(revealDelta(container, element)).toBe(150);
  });

  it('start-aligns a card taller than the list', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 200, 1200);
    expect(revealDelta(container, element)).toBe(200);
  });
});

describe('nearestDelta', () => {
  it('does nothing when the card sits inside the scrollport', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 200, 400);
    expect(nearestDelta(container, element)).toBe(0);
  });

  it('start-aligns when the card top sits above the scroll-padding inset', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    container.style.scrollPaddingTop = '8px';
    box(container, 0, 800);
    box(element, 4, 200);
    expect(nearestDelta(container, element)).toBe(-4);
  });

  it('start-aligns when the card sits entirely above the list', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, -200, -50);
    expect(nearestDelta(container, element)).toBe(-200);
  });

  it('end-aligns a card that sits entirely below the list', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 900, 1100);
    expect(nearestDelta(container, element)).toBe(300);
  });
});

describe('listScrollBehavior', () => {
  it('returns auto when reduced motion is preferred', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
    } as MediaQueryList);
    expect(listScrollBehavior()).toBe('auto');
  });

  it('returns smooth otherwise', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
    } as MediaQueryList);
    expect(listScrollBehavior()).toBe('smooth');
  });
});

describe('leadingThrottle', () => {
  it('allows the first call and blocks calls inside the interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const throttle = leadingThrottle(300);
    expect(throttle()).toBe(true);
    vi.setSystemTime(100);
    expect(throttle()).toBe(false);
    vi.setSystemTime(300);
    expect(throttle()).toBe(true);
    vi.useRealTimers();
  });
});

describe('keyboardRevealDelta', () => {
  it('end-aligns a short card whose bottom is clipped when moving down', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 720, 820);
    expect(keyboardRevealDelta(container, element, 'next')).toBe(20);
  });

  it('start-aligns a short card whose top is clipped when moving up', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, -20, 80);
    expect(keyboardRevealDelta(container, element, 'prev')).toBe(-20);
  });

  it('does nothing when the card already fits in the scrollport', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 200, 400);
    expect(keyboardRevealDelta(container, element, 'next')).toBe(0);
    expect(keyboardRevealDelta(container, element, 'prev')).toBe(0);
  });

  it('does nothing for a tall card at the bottom so the next message can load', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, -800, 800);
    expect(keyboardRevealDelta(container, element, 'next')).toBe(0);
    expect(pageThenAdvanceDelta(container, element, 'next')).toBe(0);
  });
});

describe('pageThenAdvanceDelta', () => {
  it('advances when the card already fits', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 200, 400);
    expect(pageThenAdvanceDelta(container, element, 'next')).toBe(0);
    expect(pageThenAdvanceDelta(container, element, 'prev')).toBe(0);
  });

  it('pages down by the remaining overflow when it is less than a viewport', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 100, 950);
    expect(pageThenAdvanceDelta(container, element, 'next')).toBe(150);
  });

  it('pages down by one viewport when overflow is larger', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 0, 2400);
    expect(pageThenAdvanceDelta(container, element, 'next')).toBe(800);
  });

  it('pages up when the card top is above the list', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, -400, 600);
    expect(pageThenAdvanceDelta(container, element, 'prev')).toBe(-400);
  });
});

describe('scrollToListStartDelta', () => {
  it('scrolls the leftover distance to the title', () => {
    const container = document.createElement('div');
    container.scrollTop = 80;
    expect(scrollToListStartDelta(container)).toBe(-80);
  });

  it('is zero when the list is already at the top', () => {
    const container = document.createElement('div');
    container.scrollTop = 0;
    expect(scrollToListStartDelta(container)).toBe(0);
  });
});

describe('scrollToListEndDelta', () => {
  it('scrolls the leftover distance to the bottom', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', {
      value: 1200,
      writable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 800,
      writable: true,
    });
    container.scrollTop = 200;
    expect(scrollToListEndDelta(container)).toBe(200);
  });

  it('is zero when the list is already at the bottom', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', {
      value: 1200,
      writable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 800,
      writable: true,
    });
    container.scrollTop = 400;
    expect(scrollToListEndDelta(container)).toBe(0);
  });
});

describe('adjustScrollAfterPrepend', () => {
  it('keeps the same card on screen when height grows above', () => {
    const container = document.createElement('div');
    let scrollHeight = 200;
    Object.defineProperty(container, 'scrollHeight', {
      get: () => scrollHeight,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 150 });
    container.scrollTop = 50;
    scrollHeight = 400;
    adjustScrollAfterPrepend(container, 200, 50);
    expect(container.scrollTop).toBe(250);
  });

  it('leaves the title pinned when you were already at the top', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { get: () => 400 });
    Object.defineProperty(container, 'clientHeight', { get: () => 150 });
    container.scrollTop = 0;
    adjustScrollAfterPrepend(container, 200, 0);
    expect(container.scrollTop).toBe(0);
  });

  it('leaves the title pinned when the first page did not overflow', () => {
    const container = document.createElement('div');
    let scrollHeight = 200;
    Object.defineProperty(container, 'scrollHeight', {
      get: () => scrollHeight,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 400 });
    container.scrollTop = 0;
    scrollHeight = 500;
    adjustScrollAfterPrepend(container, 200, 0);
    expect(container.scrollTop).toBe(0);
  });
});

describe('listNeedsOlderPage', () => {
  const ready = {
    initialLoadComplete: true,
    isScrollingToMessage: false,
    isFetching: false,
    hasMore: true,
    scrollHeight: 200,
    clientHeight: 400,
  };

  it('fetches when the first page does not overflow', () => {
    expect(listNeedsOlderPage(ready)).toBe(true);
  });

  it('waits for overflow scroll once the list is taller than the view', () => {
    expect(
      listNeedsOlderPage({ ...ready, scrollHeight: 800, clientHeight: 400 })
    ).toBe(false);
  });

  it('does not fetch while loading, scrolling, or finished', () => {
    expect(listNeedsOlderPage({ ...ready, initialLoadComplete: false })).toBe(
      false
    );
    expect(listNeedsOlderPage({ ...ready, isScrollingToMessage: true })).toBe(
      false
    );
    expect(listNeedsOlderPage({ ...ready, isFetching: true })).toBe(false);
    expect(listNeedsOlderPage({ ...ready, hasMore: false })).toBe(false);
  });
});

describe('fetchOlderMessages', () => {
  it('uses live scrollTop after the fetch completes', async () => {
    vi.useFakeTimers();
    const list = document.createElement('div');
    let scrollHeight = 200;
    Object.defineProperty(list, 'scrollHeight', { get: () => scrollHeight });
    Object.defineProperty(list, 'clientHeight', { get: () => 150 });
    list.scrollTop = 10;

    const fetchNextPage = vi.fn(async () => {
      list.scrollTop = 40;
      scrollHeight = 400;
    });

    const pending = fetchOlderMessages(list, fetchNextPage);
    await vi.runAllTimersAsync();
    await pending;

    expect(list.scrollTop).toBe(240);
    vi.useRealTimers();
  });
});
