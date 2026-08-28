// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  adjustScrollAfterPrepend,
  alignmentDelta,
  hiddenMessagesControl,
  hiddenMessagesFollowsShownIndex,
  hiddenMessagesPrecedesShownIndex,
  isTruncatedMiddleMessage,
  nearestDelta,
  nextShownChronologicalIndex,
  pageThenAdvanceDelta,
  prevShownChronologicalIndex,
  revealDelta,
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

describe('nextShownChronologicalIndex', () => {
  it('treats the expand control as a break', () => {
    expect(nextShownChronologicalIndex(0, 6, false)).toBeNull();
    expect(nextShownChronologicalIndex(4, 6, false)).toBe(5);
  });

  it('steps into the first revealed middle card once open', () => {
    expect(nextShownChronologicalIndex(0, 6, true)).toBe(1);
  });
});

describe('prevShownChronologicalIndex', () => {
  it('treats the expand control as a break', () => {
    expect(prevShownChronologicalIndex(0, 6, false)).toBeNull();
    expect(prevShownChronologicalIndex(4, 6, false)).toBeNull();
    expect(prevShownChronologicalIndex(5, 6, false)).toBe(4);
  });

  it('walks consecutive shown messages when the middle is open', () => {
    expect(prevShownChronologicalIndex(1, 6, true)).toBe(0);
    expect(prevShownChronologicalIndex(5, 6, true)).toBe(4);
  });
});

describe('hiddenMessages chip stops', () => {
  it('sits after the first shown card when the middle is collapsed', () => {
    expect(hiddenMessagesFollowsShownIndex(0, 6, false)).toBe(true);
    expect(hiddenMessagesFollowsShownIndex(0, 6, true)).toBe(false);
    expect(hiddenMessagesFollowsShownIndex(4, 6, false)).toBe(false);
  });

  it('sits before the penultimate shown card when the middle is collapsed', () => {
    expect(hiddenMessagesPrecedesShownIndex(4, 6, false)).toBe(true);
    expect(hiddenMessagesPrecedesShownIndex(5, 6, false)).toBe(false);
    expect(hiddenMessagesPrecedesShownIndex(4, 6, true)).toBe(false);
  });

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
  it('does nothing when any part of the card is on screen', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 200, 400);
    expect(nearestDelta(container, element)).toBe(0);
    box(element, -200, 200);
    expect(nearestDelta(container, element)).toBe(0);
  });

  it('end-aligns a card that sits entirely below the list', () => {
    const container = document.createElement('div');
    const element = document.createElement('div');
    box(container, 0, 800);
    box(element, 900, 1100);
    expect(nearestDelta(container, element)).toBe(300);
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

describe('adjustScrollAfterPrepend', () => {
  it('keeps the same card on screen when height grows above', () => {
    const container = document.createElement('div');
    let scrollHeight = 200;
    Object.defineProperty(container, 'scrollHeight', {
      get: () => scrollHeight,
    });
    container.scrollTop = 50;
    scrollHeight = 400;
    adjustScrollAfterPrepend(container, 200, 50);
    expect(container.scrollTop).toBe(250);
  });

  it('leaves the title pinned when you were already at the top', () => {
    const container = document.createElement('div');
    container.scrollTop = 0;
    adjustScrollAfterPrepend(container, 200, 0);
    expect(container.scrollTop).toBe(0);
  });
});
