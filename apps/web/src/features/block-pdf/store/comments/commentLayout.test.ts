import type { Root } from '@core/comments/commentType';
import { describe, expect, it, vi } from 'vitest';
import type { CommentLayout, PdfRootLayout } from '../../type/comments';
import { computePageCommentLayout } from './commentLayout';

vi.mock('../../context/pdf-document-context', () => ({
  usePdfDocument: vi.fn(),
}));

function thread(threadId: number, originalYPosition: number): PdfRootLayout {
  return {
    threadId,
    layout: {
      pageIndex: 0,
      originalYPosition,
    },
  } as PdfRootLayout;
}

function positions(layouts: CommentLayout<Root>[]) {
  return layouts.map(({ threadId, layout }) => ({
    threadId,
    ...layout,
  }));
}

describe('computePageCommentLayout', () => {
  it('returns no layout without page bounds or root comments', () => {
    expect(
      computePageCommentLayout({
        comments: [thread(1, 100)],
        activeThreadId: null,
        pageHeight: undefined,
        threadHeights: { 1: 40 },
      })
    ).toEqual([]);
    expect(
      computePageCommentLayout({
        comments: [],
        activeThreadId: null,
        pageHeight: 800,
        threadHeights: {},
      })
    ).toEqual([]);
  });

  it('sorts by original position and anchors the first thread by default', () => {
    const result = computePageCommentLayout({
      comments: [thread(3, 300), thread(1, 100), thread(2, 200)],
      activeThreadId: null,
      pageHeight: 1000,
      threadHeights: { 1: 30, 2: 20, 3: 40 },
    });

    expect(positions(result)).toEqual([
      {
        threadId: 1,
        height: 30,
        calculatedYPos: 100,
        overflow: null,
      },
      {
        threadId: 2,
        height: 20,
        calculatedYPos: 200,
        overflow: null,
      },
      {
        threadId: 3,
        height: 40,
        calculatedYPos: 300,
        overflow: null,
      },
    ]);
  });

  it('uses the active thread as the page anchor', () => {
    const result = computePageCommentLayout({
      comments: [thread(1, 190), thread(2, 200), thread(3, 205)],
      activeThreadId: 2,
      pageHeight: 1000,
      threadHeights: { 1: 30, 2: 20, 3: 20 },
    });

    expect(positions(result)).toEqual([
      {
        threadId: 1,
        height: 30,
        calculatedYPos: 154,
        overflow: null,
      },
      {
        threadId: 2,
        height: 20,
        calculatedYPos: 200,
        overflow: null,
      },
      {
        threadId: 3,
        height: 20,
        calculatedYPos: 236,
        overflow: null,
      },
    ]);
  });

  it('preserves gaps, overflow, padding, and oversized anchor handling', () => {
    const result = computePageCommentLayout({
      comments: [thread(1, 10), thread(2, 170), thread(3, 210), thread(4, 220)],
      activeThreadId: 3,
      pageHeight: 300,
      threadHeights: { 1: 60, 2: 30, 3: 40, 4: 50 },
    });

    expect(positions(result)).toEqual([
      {
        threadId: 1,
        height: 60,
        calculatedYPos: 10,
        overflow: 'top',
      },
      {
        threadId: 2,
        height: 30,
        calculatedYPos: 134,
        overflow: null,
      },
      {
        threadId: 3,
        height: 40,
        calculatedYPos: 180,
        overflow: null,
      },
      {
        threadId: 4,
        height: 50,
        calculatedYPos: 236,
        overflow: 'bottom',
      },
    ]);

    expect(
      positions(
        computePageCommentLayout({
          comments: [thread(5, 100)],
          activeThreadId: 5,
          pageHeight: 300,
          threadHeights: { 5: 400 },
        })
      )
    ).toEqual([
      {
        threadId: 5,
        height: 400,
        calculatedYPos: 0,
        overflow: null,
      },
    ]);
  });

  it('repositions neighbors when measured heights change', () => {
    const comments = [thread(1, 100), thread(2, 105)];

    const shortAnchor = computePageCommentLayout({
      comments,
      activeThreadId: 1,
      pageHeight: 1000,
      threadHeights: { 1: 20, 2: 30 },
    });
    const tallAnchor = computePageCommentLayout({
      comments,
      activeThreadId: 1,
      pageHeight: 1000,
      threadHeights: { 1: 80, 2: 30 },
    });

    expect(shortAnchor[1].layout.calculatedYPos).toBe(136);
    expect(tallAnchor[1].layout.calculatedYPos).toBe(196);
  });
});
