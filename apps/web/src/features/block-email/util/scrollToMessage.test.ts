// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  alignmentDelta,
  type OpenTargetMessage,
  openTargetMessageId,
  reversedChildIndex,
  shouldPageForOldestUnread,
  collapsedRowShowsDivider,
  isTruncatedMiddleMessage,
  nextShownChronologicalIndex,
  prevShownChronologicalIndex,
  shownOpenCardFlush,
  threadMessageIsExpanded,
  truncatedMiddleCount,
} from './scrollToMessage';

function msg(id: string, unread = false): OpenTargetMessage {
  return {
    db_id: id,
    labels: unread ? [{ provider_label_id: 'UNREAD' }] : [],
  };
}

function box(
  element: HTMLElement,
  top: number,
  bottom: number
): void {
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

describe('reversedChildIndex', () => {
  it('maps oldest-first index onto a reversed DOM list', () => {
    expect(reversedChildIndex(0, 3)).toBe(2);
    expect(reversedChildIndex(2, 3)).toBe(0);
    expect(reversedChildIndex(1, 3)).toBe(1);
  });

  it('returns -1 when the message is missing', () => {
    expect(reversedChildIndex(-1, 3)).toBe(-1);
  });
});

describe('openTargetMessageId', () => {
  it('returns newest when every message is unread', () => {
    expect(openTargetMessageId([msg('a', true), msg('b', true), msg('c', true)])).toBe(
      'c'
    );
  });

  it('skips older read messages to the first unread', () => {
    expect(openTargetMessageId([msg('a'), msg('b', true), msg('c', true)])).toBe(
      'b'
    );
  });

  it('falls back to newest when nothing is unread', () => {
    expect(openTargetMessageId([msg('a'), msg('b'), msg('c')])).toBe('c');
  });

  it('returns undefined for an empty list', () => {
    expect(openTargetMessageId([])).toBeUndefined();
  });
});

describe('shouldPageForOldestUnread', () => {
  it('pages while the oldest loaded message is unread and more exist', () => {
    expect(shouldPageForOldestUnread([msg('b', true), msg('c', true)], true)).toBe(
      true
    );
  });

  it('stops when a read message is older than every unread', () => {
    expect(shouldPageForOldestUnread([msg('a'), msg('b', true)], true)).toBe(
      false
    );
  });

  it('stops at the start of the thread', () => {
    expect(shouldPageForOldestUnread([msg('a', true)], false)).toBe(false);
  });
});

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

describe('collapsedRowShowsDivider', () => {
  it('hides the divider when the expand control is next', () => {
    expect(nextShownChronologicalIndex(0, 6, false)).toBeNull();
    expect(collapsedRowShowsDivider(0, 6, false, true)).toBe(false);
  });

  it('hides the divider when the next shown message is an opened card', () => {
    expect(nextShownChronologicalIndex(4, 6, false)).toBe(5);
    expect(collapsedRowShowsDivider(4, 6, false, false)).toBe(false);
  });

  it('keeps the divider between two shown collapsed rows', () => {
    expect(collapsedRowShowsDivider(0, 6, true, true)).toBe(true);
    expect(collapsedRowShowsDivider(1, 6, true, true)).toBe(true);
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

describe('threadMessageIsExpanded', () => {
  it('opens the newest message and unread, draft, or manual cards', () => {
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 2,
        listLength: 3,
        isManuallyExpanded: false,
        isUnread: false,
        hasDraft: false,
      })
    ).toBe(true);
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 0,
        listLength: 3,
        isManuallyExpanded: false,
        isUnread: true,
        hasDraft: false,
      })
    ).toBe(true);
    expect(
      threadMessageIsExpanded({
        chronologicalIndex: 1,
        listLength: 3,
        isManuallyExpanded: false,
        isUnread: false,
        hasDraft: false,
      })
    ).toBe(false);
  });
});

describe('shownOpenCardFlush', () => {
  it('squares only the edges that touch another open card', () => {
    const expandedAt = (index: number) => index === 1 || index === 2;
    expect(shownOpenCardFlush(1, 3, true, expandedAt)).toEqual({
      top: false,
      bottom: true,
    });
    expect(shownOpenCardFlush(2, 3, true, expandedAt)).toEqual({
      top: true,
      bottom: false,
    });
  });

  it('does not flush across the expand control', () => {
    const expandedAt = () => true;
    expect(shownOpenCardFlush(0, 6, false, expandedAt)).toEqual({
      top: false,
      bottom: false,
    });
    expect(shownOpenCardFlush(4, 6, false, expandedAt)).toEqual({
      top: false,
      bottom: true,
    });
  });

  it('keeps full radius next to a collapsed row', () => {
    expect(shownOpenCardFlush(2, 3, true, (index) => index === 2)).toEqual({
      top: false,
      bottom: false,
    });
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
