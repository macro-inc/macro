import { describe, expect, it } from 'vitest';
import {
  createChatFixture,
  MIN_OUTSIDE_FIRST_PAGES,
  MIN_SECTION_COVERAGE,
  sectionCoverage,
} from './fixture';

type Page = { items: unknown[]; nextCursor: string | null };
type SoupRoot = {
  user: { soup(args: { input: unknown }): Page };
};

function firstPage(limit?: number | null) {
  const fixture = createChatFixture(700);
  const root = fixture.rootValue() as SoupRoot;
  const page = root.user.soup({
    input: { initial: limit === undefined ? {} : { limit } },
  });
  return { page, reads: fixture.reads() };
}

describe('the Chat scale fixture', () => {
  it('pages as GraphQL Soup does: 20 rows by default, a limit kept to 1–500', () => {
    expect(firstPage().page.items).toHaveLength(20);
    expect(firstPage(null).page.items).toHaveLength(20);
    expect(firstPage(0).page.items).toHaveLength(1);
    expect(firstPage(100).page.items).toHaveLength(100);
    expect(firstPage(600).page.items).toHaveLength(500);
  });

  it('faults a limit the schema refuses, instead of serving a page', () => {
    for (const limit of [-1, 65_536, 2.5]) {
      const { page, reads } = firstPage(limit);
      expect(page).toEqual({ items: [], nextCursor: null });
      expect(reads.unsupported).toEqual([`limit ${limit}`]);
    }
  });

  it('gives a full last page a cursor to one more, empty page', () => {
    const fixture = createChatFixture(500);
    const root = fixture.rootValue() as SoupRoot;
    const first = root.user.soup({ input: { initial: { limit: 500 } } });
    expect(first.items).toHaveLength(500);
    expect(first.nextCursor).not.toBeNull();
    const rest = root.user.soup({
      input: { continuation: { cursor: first.nextCursor } },
    });
    expect(rest).toEqual({ items: [], nextCursor: null });
    expect(fixture.reads().unsupported).toEqual([]);
  });

  it('ends a short page without a cursor', () => {
    const fixture = createChatFixture(700);
    const root = fixture.rootValue() as SoupRoot;
    const first = root.user.soup({ input: { initial: { limit: 500 } } });
    expect(first.items).toHaveLength(500);
    const rest = root.user.soup({
      input: { continuation: { cursor: first.nextCursor } },
    });
    expect(rest.items).toHaveLength(200);
    expect(rest.nextCursor).toBeNull();
  });
});

type FilteredRoot = {
  user: {
    soup(args: { input: unknown }): { items: Array<{ id: string }> };
    favorites(args: {
      filter?: { entityIds?: string[] };
    }): Array<{ entityId: string }>;
  };
};

function channelsMatching(channelFilter: unknown) {
  const fixture = createChatFixture(700);
  const root = fixture.rootValue() as FilteredRoot;
  const page = root.user.soup({
    input: { initial: { limit: 500, filters: { channelFilter } } },
  });
  return { fixture, ids: page.items.map((item) => item.id) };
}

describe('the Chat scale fixture, filtering', () => {
  it('serves an organization only its own team channels', () => {
    const { fixture, ids } = channelsMatching({
      literal: { organizationId: 1 },
    });
    const teamIds = fixture.channels
      .filter((channel) => channel.channelType === 'team')
      .map((channel) => channel.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(teamIds).toEqual(expect.arrayContaining(ids));
    expect(channelsMatching({ literal: { organizationId: 2 } }).ids).toEqual(
      []
    );
  });

  it('leaves out channels with no organization when negating one, as SQL does', () => {
    const { fixture, ids } = channelsMatching({
      not: { literal: { organizationId: 1 } },
    });
    expect(ids).toEqual([]);
    const noTeam = channelsMatching({
      not: { literal: { teamId: 'another-team' } },
    });
    expect(noTeam.ids.length).toBeGreaterThan(0);
    for (const id of noTeam.ids)
      expect(
        fixture.channels.find((channel) => channel.id === id)?.channelType
      ).toBe('team');
  });

  it('serves an explicit null channel filter as no filter', () => {
    const { fixture, ids } = channelsMatching(null);
    expect(ids).toHaveLength(500);
    expect(fixture.reads().unsupported).toEqual([]);
  });

  it('faults a literal it cannot read on a branch matching never visits', () => {
    const { fixture } = channelsMatching({
      or: {
        left: { literal: { isParticipant: true } },
        right: { literal: { archived: true } },
      },
    });
    expect(fixture.reads().unsupported).toEqual(['channel literal archived']);
  });

  it('returns only the favorites asked for by ID', () => {
    const fixture = createChatFixture(700);
    const root = fixture.rootValue() as FilteredRoot;
    const [first] = fixture.favoriteChannelIds;
    expect(
      root.user
        .favorites({ filter: { entityIds: [first ?? ''] } })
        .map((favorite) => favorite.entityId)
    ).toEqual([first]);
    expect(root.user.favorites({})).toHaveLength(
      fixture.favoriteChannelIds.length
    );
  });

  it('gives two messages in one channel their own ids', () => {
    const fixture = createChatFixture(700);
    const [channel] = fixture.channels;
    const delivered = [1, 2].map((minute) => {
      const frames = fixture.deliverMessage(channel?.id ?? '', minute * 60_000);
      const { notification } = frames.NotificationUpdates
        .notificationUpdates as {
        notification: { id: string; metadata: { messageId: string } };
      };
      return notification;
    });
    expect(new Set(delivered.map(({ id }) => id)).size).toBe(2);
    expect(
      new Set(delivered.map(({ metadata }) => metadata.messageId)).size
    ).toBe(2);
  });

  it('keeps a message’s frames to that message when another follows', () => {
    const fixture = createChatFixture(700);
    const [channel] = fixture.channels;
    const first = fixture.deliverMessage(channel?.id ?? '', 60_000);
    fixture.deliverMessage(channel?.id ?? '', 120_000);
    const [update] = first.SoupUpdates.soupUpdates as Array<{
      item: {
        updatedAt: string;
        latestMessage(): { createdAt: string };
        notifications(args: object): unknown[];
      };
    }>;
    expect(update?.item.updatedAt).toBe(new Date(60_000).toISOString());
    expect(update?.item.latestMessage().createdAt).toBe(
      new Date(60_000).toISOString()
    );
    const unseen = update?.item.notifications({
      filter: { states: ['UNSEEN'] },
    });
    const later = fixture.channels[0]?.notifications.filter(
      (notification) => notification.state === 'UNSEEN'
    );
    expect(unseen).toHaveLength((later?.length ?? 0) - 1);
  });
});

describe('the Chat scale fixture, sections', () => {
  const atN = createChatFixture(3_500, 1);
  const at2N = createChatFixture(7_000, 1);
  const scopes = ['team', 'personal'] as const;

  it('holds nine in ten of the channels a section can hold, most past the first pages', () => {
    for (const fixture of [atN, at2N]) {
      const coverage = sectionCoverage(fixture);
      expect(coverage.held / coverage.holdable).toBeGreaterThanOrEqual(
        MIN_SECTION_COVERAGE
      );
      expect(
        coverage.outsideFirstPages / coverage.referenced
      ).toBeGreaterThanOrEqual(MIN_OUTSIDE_FIRST_PAGES);
    }
  });

  it('names about twice the channels at 2N, keeping every member N had', () => {
    expect(sectionCoverage(at2N).referenced).toBeGreaterThanOrEqual(
      1.9 * sectionCoverage(atN).referenced
    );
    for (const scope of scopes) {
      const larger = at2N.labels(scope).labels;
      for (const [index, label] of atN.labels(scope).labels.entries())
        expect(larger[index]?.channelIds).toEqual(
          expect.arrayContaining(label.channelIds)
        );
    }
  });

  it('puts in each section only channels the app lets it hold', () => {
    const typeOf = new Map(
      atN.channels.map((channel) => [channel.id, channel.channelType])
    );
    for (const label of atN.labels('team').labels)
      for (const id of label.channelIds) expect(typeOf.get(id)).toBe('team');
    const personal = atN.labels('personal').labels;
    for (const label of personal)
      for (const id of label.channelIds)
        expect(typeOf.get(id)).not.toBe('direct_message');
    const ruled = personal.find((label) => label.rule);
    expect(ruled?.explicitChannelIds).toEqual([]);
    expect(ruled?.channelIds).toEqual(
      atN.channels
        .filter((channel) => channel.channelType === 'private')
        .map((channel) => channel.id)
    );
  });

  it('keeps half the favorites in the older half of the account', () => {
    const older = new Set(
      at2N.channels.slice(3_500).map((channel) => channel.id)
    );
    expect(at2N.favoriteChannelIds).toHaveLength(12);
    expect(at2N.favoriteChannelIds.filter((id) => older.has(id))).toHaveLength(
      6
    );
  });

  it('saves every section collapsed but Favorites, Direct messages and one team section', () => {
    const labels = scopes.flatMap((scope) => atN.labels(scope).labels);
    const open = labels.filter(
      (label) => !atN.savedView.collapsedLabels.includes(label.id)
    );
    expect(open.map((label) => label.teamId)).toEqual(['team-1']);
    expect(atN.savedView.expandedGroups).toEqual({
      favorites: true,
      team_channels: false,
      channels: false,
      direct_messages: true,
    });
  });
});
