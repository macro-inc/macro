import { describe, expect, it } from 'vitest';
import {
  anchorAt,
  anchorPoint,
  byActivity,
  type FigCommentThread,
  filterThreads,
  insertMention,
  isUnread,
  mentionParts,
  mentionQuery,
  mentionsIn,
} from './comments';

const alex = { id: 'u1', name: 'Alex Morgan' };
const blair = { id: 'u2', name: 'Blair' };

const thread = (
  id: string,
  resolved: boolean,
  times: [string, number][]
): FigCommentThread => ({
  id,
  anchor: null,
  resolved,
  comments: times.map(([author, createdAt], k) => ({
    id: `${id}-${k}`,
    author: author === 'u1' ? alex : blair,
    text: 'hi',
    mentions: [],
    createdAt,
  })),
});

describe('anchoring', () => {
  it('pins to a layer relative to its top left, so it moves with it', () => {
    const node = { id: '1:10', bounds: { x: 100, y: 50, w: 300, h: 200 } };
    const anchor = anchorAt('0:1', { x: 130.123, y: 75 }, node);
    expect(anchor).toEqual({ pageId: '0:1', nodeId: '1:10', x: 30.12, y: 25 });
    const moved = new Map([['1:10', { x: 400, y: 0, w: 300, h: 200 }]]);
    expect(anchorPoint(anchor, moved)).toEqual({ x: 430.12, y: 25 });
    // A deleted layer's comment has nowhere to pin.
    expect(anchorPoint(anchor, new Map())).toBeUndefined();
  });

  it('pins to the canvas at page coordinates', () => {
    const anchor = anchorAt('0:1', { x: -20, y: 40 });
    expect(anchor).toEqual({ pageId: '0:1', nodeId: null, x: -20, y: 40 });
    expect(anchorPoint(anchor, new Map())).toEqual({ x: -20, y: 40 });
  });
});

describe('threads', () => {
  const threads = [
    thread('a', false, [['u1', 10]]),
    thread('b', true, [['u2', 30]]),
    thread('c', false, [
      ['u1', 5],
      ['u2', 40],
    ]),
  ];

  it('filters open and resolved threads, newest activity first', () => {
    expect(filterThreads(threads, 'open').map((t) => t.id)).toEqual(['a', 'c']);
    expect(filterThreads(threads, 'resolved').map((t) => t.id)).toEqual(['b']);
    expect(byActivity(threads).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('is unread when someone else commented after it was read', () => {
    const [a, , c] = threads;
    expect(isUnread(a, 'u1', undefined)).toBe(false);
    expect(isUnread(c, 'u1', undefined)).toBe(true);
    expect(isUnread(c, 'u1', 40)).toBe(false);
    expect(isUnread(c, 'u1', 39)).toBe(true);
    expect(isUnread(c, 'u2', undefined)).toBe(true);
  });
});

describe('mentions', () => {
  it('finds the @query being typed', () => {
    expect(mentionQuery('Hey @Bl', 7)).toEqual({ start: 4, query: 'Bl' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('mail@example', 12)).toBeUndefined();
    expect(mentionQuery('Hey @Blair done', 15)).toBeUndefined();
  });

  it('inserts a mention and keeps those still in the text', () => {
    const r = insertMention('Hey @Bl!', 4, 7, blair);
    expect(r).toEqual({ text: 'Hey @Blair !', caret: 11 });
    expect(mentionsIn(r.text, [blair, alex, blair])).toEqual([blair]);
    expect(mentionsIn('Hey', [blair])).toEqual([]);
  });

  it('splits text into mentions for display, longest names first', () => {
    const parts = mentionParts('cc @Alex Morgan and @Blair.', [alex, blair]);
    expect(parts).toEqual([
      { text: 'cc ' },
      { text: '@Alex Morgan', mention: alex },
      { text: ' and ' },
      { text: '@Blair', mention: blair },
      { text: '.' },
    ]);
  });
});
