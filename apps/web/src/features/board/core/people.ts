import type { Bounds, Size } from './camera';
import type {
  BoardAuthor,
  BoardItem,
  BoardItemKind,
  BoardMessage,
  BoardZone,
} from './item';
import { type RegionMetrics, tileRegions } from './regions';

/** One thing a person said, and where. */
export type PersonLine = {
  itemKey: string;
  itemTitle: string;
  itemKind: BoardItemKind;
  zone: BoardZone;
  message: BoardMessage;
};

export type BoardPerson = {
  /** `person:<author id>`, distinct from item keys. */
  key: string;
  author: BoardAuthor;
  /** Newest first, at most `MAX_PERSON_LINES`. */
  lines: PersonLine[];
  lastActivityAt: number;
  unreadCount: number;
};

export const MAX_PERSON_LINES = 4;

export const PEOPLE_GROUPS = ['person', 'contact', 'agent'] as const;
export type PeopleGroup = (typeof PEOPLE_GROUPS)[number];

/**
 * Everyone except the viewer who said something on the board, with what
 * they said across every conversation. Unread voices lead, then the most
 * recent.
 */
export function gatherPeople(items: readonly BoardItem[]): BoardPerson[] {
  const people = new Map<string, BoardPerson & { all: PersonLine[] }>();
  for (const item of items) {
    for (const message of item.messages) {
      const author = message.author;
      if (!author || author.isSelf) continue;
      const line = {
        itemKey: item.key,
        itemTitle: item.title,
        itemKind: item.kind,
        zone: item.zone,
        message,
      };
      const person = people.get(author.id);
      if (person) {
        person.all.push(line);
        person.lastActivityAt = Math.max(person.lastActivityAt, message.at);
        if (message.unread) person.unreadCount += 1;
      } else {
        people.set(author.id, {
          key: `person:${author.id}`,
          author,
          lines: [],
          all: [line],
          lastActivityAt: message.at,
          unreadCount: message.unread ? 1 : 0,
        });
      }
    }
  }
  return [...people.values()]
    .map(({ all, ...person }) => ({
      ...person,
      lines: all
        .sort((a, b) => b.message.at - a.message.at)
        .slice(0, MAX_PERSON_LINES),
    }))
    .sort(
      (a, b) =>
        Number(b.unreadCount > 0) - Number(a.unreadCount > 0) ||
        b.lastActivityAt - a.lastActivityAt
    );
}

/** A person as the lifecycle rules see them: one conversation with many places. */
export function personAsItem(person: BoardPerson): BoardItem {
  return {
    key: person.key,
    zone: person.lines[0]?.zone ?? 'channels',
    kind: 'dm',
    title: person.author.name,
    messages: [...person.lines].reverse().map((line) => line.message),
    lastActivityAt: person.lastActivityAt,
    unreadCount: person.unreadCount,
    needsYou: false,
    participants: [person.author],
    face: person.author,
  };
}

export const PEOPLE_METRICS: RegionMetrics = {
  columnWidth: 300,
  header: 46,
  padding: 18,
  cellGap: 14,
  regionGap: 44,
};

export function estimatePersonHeight(person: BoardPerson): number {
  return (
    64 +
    person.lines.reduce(
      (total, line) =>
        total + Math.min(3, Math.ceil(line.message.text.length / 34)) * 18 + 34,
      0
    )
  );
}

export type PeopleLayout = {
  cards: ReadonlyMap<string, Bounds>;
  groups: { group: PeopleGroup; bounds: Bounds; count: number }[];
  bounds: Bounds | undefined;
};

/** V1E. Teammates, outside contacts and agents each get a region of cards. */
export function layoutPeople(
  people: readonly BoardPerson[],
  measured: (key: string) => Size | undefined
): PeopleLayout {
  const members = (group: PeopleGroup) =>
    people.filter((person) => person.author.kind === group);
  const { regions, bounds } = tileRegions(
    PEOPLE_GROUPS.map((group) => {
      const groupPeople = members(group);
      return {
        id: group,
        count: groupPeople.length,
        height: (index: number) =>
          measured(groupPeople[index].key)?.height ??
          estimatePersonHeight(groupPeople[index]),
      };
    }),
    PEOPLE_METRICS
  );
  const cards = new Map<string, Bounds>();
  const groups = regions.map((region) => {
    const groupPeople = members(region.id);
    groupPeople.forEach((person, index) =>
      cards.set(person.key, region.cells[index])
    );
    return {
      group: region.id,
      bounds: region.bounds,
      count: groupPeople.length,
    };
  });
  return { cards, groups, bounds };
}
