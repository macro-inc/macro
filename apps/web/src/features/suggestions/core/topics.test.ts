import { describe, expect, it } from 'vitest';
import { reviewSuggestion } from '../tests/fixtures';
import type { FeedEntry, RowState } from './lists';
import type { Topic } from './suggestion';
import { groupByTopic, shownTopics } from './topics';

function row(id: string, topic?: string, state: RowState = 'open'): FeedEntry {
  return {
    suggestion: {
      ...reviewSuggestion,
      id,
      ...(topic ? { topic: { key: topic, name: `${topic} as read` } } : {}),
    },
    state,
    isNew: false,
    busy: false,
    failed: false,
    changed: false,
    canUndo: false,
  };
}

function topic(key: string, reason?: string): Topic {
  return { key, name: key.toUpperCase(), ...(reason ? { reason } : {}) };
}

const ids = (groups: ReturnType<typeof groupByTopic>) =>
  groups.map((group) => [
    group.topic?.key,
    group.entries.map((entry) => entry.suggestion.id),
  ]);

describe('topics', () => {
  it('groups the topics with two rows, in the order of their first rows, and leaves the rest last', () => {
    const rows = [
      row('1', 'offsite'),
      row('2'),
      row('3', 'acme'),
      row('4', 'lone'),
      row('5', 'offsite'),
      row('6', 'acme'),
    ];
    const topics = shownTopics(rows, [
      topic('acme'),
      topic('offsite', 'Deposit due June 2'),
      topic('lone', 'Only one row'),
    ]);

    expect(topics.map(({ key, reason }) => [key, reason])).toEqual([
      ['offsite', 'Deposit due June 2'],
      ['acme', undefined],
    ]);
    expect(ids(groupByTopic(rows, topics))).toEqual([
      ['offsite', ['1', '5']],
      ['acme', ['3', '6']],
      [undefined, ['2', '4']],
    ]);
  });

  it('has one group without topics, and none without rows', () => {
    const rows = [row('1'), row('2', 'lone')];
    expect(ids(groupByTopic(rows, shownTopics(rows, [topic('lone')])))).toEqual(
      [[undefined, ['1', '2']]]
    );
    expect(groupByTopic([], [])).toEqual([]);
  });

  it('keeps a topic together while its rows settle, counting the ones that wait', () => {
    const rows = [
      row('1', 'offsite', 'markedDone'),
      row('2', 'offsite', 'dismissed'),
      row('3', 'acme', 'failed'),
      row('4', 'acme', 'running'),
      row('5', 'acme', 'finished'),
    ];
    // The feed no longer lists a topic none of whose suggestions are open.
    const topics = shownTopics(rows, [topic('acme')]);

    expect(
      topics.map(({ key, name, waiting }) => [key, name, waiting])
    ).toEqual([
      ['offsite', 'offsite as read', 0],
      ['acme', 'ACME', 2],
    ]);
  });

  it('gives topics shown together different colours, whatever order their rows are in', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const rows = keys.flatMap((key) => [row(`${key}1`, key), row(key, key)]);
    const hues = (entries: FeedEntry[]) =>
      Object.fromEntries(
        shownTopics(entries, []).map(({ key, hue }) => [key, hue])
      );

    expect(new Set(Object.values(hues(rows.slice(0, 12)))).size).toBe(6);
    expect(hues(rows)).toEqual(hues(rows.toReversed()));
  });
});
