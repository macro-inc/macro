import type { FeedEntry } from './lists';
import type { Topic } from './suggestion';

/** A topic groups rows only from this many: a heading over one row says nothing the row doesn't. */
const MIN_ROWS = 2;

/** A topic's colour on the page, told apart from the topics it is shown with. */
export type TopicHue =
  | 'blue'
  | 'violet'
  | 'orange'
  | 'teal'
  | 'pink'
  | 'yellow';

// Not red or green, which a failed and a finished row have.
const HUES: readonly TopicHue[] = [
  'blue',
  'violet',
  'orange',
  'teal',
  'pink',
  'yellow',
];

/** A topic that groups rows on the page. */
export type ShownTopic = {
  key: string;
  name: string;
  /** Why it matters now; absent when nothing it says still holds. */
  reason?: string;
  /** How many of its rows wait on the person, or run. */
  waiting: number;
  hue: TopicHue;
};

/** Rows under one topic, or those under none. */
export type TopicGroup = { topic?: ShownTopic; entries: FeedEntry[] };

function waits(entry: FeedEntry): boolean {
  return (
    entry.state === 'open' ||
    entry.state === 'running' ||
    entry.state === 'failed'
  );
}

/**
 * Each key's hue: its own, or the next one free among the topics it is shown
 * with. Taken in key order, so the order of the rows never changes a colour.
 */
function huesOf(keys: readonly string[]): Map<string, TopicHue> {
  const hues = new Map<string, TopicHue>();
  for (const key of keys.toSorted()) {
    let start = 0;
    for (const char of key) {
      start = (start * 31 + (char.codePointAt(0) ?? 0)) % HUES.length;
    }
    const from = [...HUES.slice(start), ...HUES.slice(0, start)];
    const taken = [...hues.values()];
    hues.set(key, from.find((hue) => !taken.includes(hue)) ?? from[0]);
  }

  return hues;
}

/**
 * The topics that group `entries`, in the order of their first rows. A row
 * that settled during the visit still counts towards its topic's two, so a
 * topic doesn't come apart while the person works through it.
 */
export function shownTopics(
  entries: readonly FeedEntry[],
  topics: readonly Topic[]
): ShownTopic[] {
  const byKey = new Map<string, FeedEntry[]>();
  for (const entry of entries) {
    const key = entry.suggestion.topic?.key;
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  const shown = [...byKey].filter(([, rows]) => rows.length >= MIN_ROWS);
  const hues = huesOf(shown.map(([key]) => key));

  return shown.map(([key, rows]) => {
    const topic = topics.find((other) => other.key === key);
    return {
      key,
      // A topic whose rows all settled is no longer in the feed's topics.
      name: topic?.name ?? rows[0].suggestion.topic?.name ?? key,
      ...(topic?.reason ? { reason: topic.reason } : {}),
      waiting: rows.filter(waits).length,
      hue: hues.get(key) ?? HUES[0],
    };
  });
}

/** Whether a row is part of the topic `key`. */
export const inTopic = (key: string) => (entry: FeedEntry) =>
  entry.suggestion.topic?.key === key;

/** `entries` under their topics, then those with none, each in their own order. */
export function groupByTopic(
  entries: readonly FeedEntry[],
  topics: readonly ShownTopic[]
): TopicGroup[] {
  const groups: TopicGroup[] = [
    ...topics.map((topic) => ({
      topic,
      entries: entries.filter(inTopic(topic.key)),
    })),
    {
      entries: entries.filter(
        (entry) => !topics.some((topic) => inTopic(topic.key)(entry))
      ),
    },
  ];

  return groups.filter((group) => group.entries.length > 0);
}
