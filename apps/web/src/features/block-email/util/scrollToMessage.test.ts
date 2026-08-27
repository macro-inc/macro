// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  alignmentDelta,
  type OpenTargetMessage,
  openTargetMessageId,
  shouldPageForOldestUnread,
  isTruncatedMiddleMessage,
  nextShownChronologicalIndex,
  prevShownChronologicalIndex,
  revealDelta,
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

describe('nextShownChronologicalIndex', () => {
  it('treats the expand control as a break', () => {
    expect(nextShownChronologicalIndex(0, 6, false)).toBeNull();
    expect(nextShownChronologicalIndex(4, 6, false)).toBe(5);
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
