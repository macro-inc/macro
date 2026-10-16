import type { EntityItem } from '@core/context/quickAccess';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankCommandSearchItems } from './rank-command-search-items';
import type { CommandMenuItem } from './useCommandItems';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function channel(
  id: string,
  name: string,
  viewedAt = NOW,
  bucket: 'channel' | 'dm' = 'channel'
): EntityItem {
  return {
    id,
    kind: 'entity',
    bucket,
    searchText: name,
    sortTimestamp: viewedAt,
    timestamps: { viewedAt: new Date(viewedAt), updatedAt: new Date(NOW) },
    data: {
      id,
      type: 'channel',
      name,
      ownerId: 'owner',
      channelType: bucket === 'dm' ? 'direct_message' : 'public',
    },
  };
}

function command(id: string, name: string, viewedAt: number): CommandMenuItem {
  return {
    id,
    kind: 'command',
    bucket: 'command',
    searchText: name,
    sortTimestamp: viewedAt,
    timestamps: { viewedAt: new Date(viewedAt) },
    data: {
      description: name,
      scopeId: 'command-menu',
      runWithInputFocused: true,
    },
  };
}

function project(id: string, name: string, updatedAt = NOW): CommandMenuItem {
  return {
    id,
    kind: 'initiative',
    bucket: 'initiative',
    name,
    searchText: name,
    sortTimestamp: updatedAt,
    timestamps: { updatedAt: new Date(updatedAt).toISOString() },
  };
}

function contact(
  id: string,
  name: string,
  lastInteraction = NOW
): CommandMenuItem {
  return {
    id,
    kind: 'entity',
    bucket: 'crm_contact',
    searchText: name,
    sortTimestamp: lastInteraction,
    timestamps: { lastInteraction: new Date(lastInteraction) },
    data: {
      id,
      type: 'crm_contact',
      ownerId: 'team',
      companyId: 'company',
      name,
      email: `${id}@example.com`,
      hidden: false,
    },
  };
}

function person(id: string, name: string): CommandMenuItem {
  return {
    id,
    kind: 'user',
    bucket: 'person',
    searchText: name,
    sortTimestamp: 0,
    timestamps: {},
    data: { id, name, email: `${id}@macro.com` },
  };
}

function ids(items: CommandMenuItem[], query: string, cacheEnabled = true) {
  return rankCommandSearchItems(items, query, {
    preserveAdditionalEntityMatches: cacheEnabled,
  }).map((item) => item.id);
}

describe('command menu search ranking', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it.each([false, true])(
    'keeps the DM preference with GraphQL %s',
    (cacheEnabled) => {
      const items = [
        channel('channel', 'Alex', NOW),
        channel('dm', 'Alex', NOW - DAY, 'dm'),
      ];
      expect(ids(items, 'Alex', cacheEnabled)).toEqual(['dm', 'channel']);
    }
  );

  it.each([false, true])(
    'ranks commands and entities by the same viewed recency with GraphQL %s',
    (cacheEnabled) => {
      const items = [
        channel('old-channel', 'Planning', NOW - 20 * DAY),
        command('command', 'Planning', NOW - DAY),
        channel('recent-channel', 'Planning', NOW),
      ];
      expect(ids(items, 'Planning', cacheEnabled)).toEqual([
        'recent-channel',
        'command',
        'old-channel',
      ]);
    }
  );

  it('keeps ranking independent of whether a match came from cached or local results', () => {
    const cached = channel('cached', 'Planning', NOW - DAY);
    const local = channel('local', 'Planning', NOW);
    expect(ids([cached, local], 'Planning')).toEqual(['local', 'cached']);
    expect(ids([local, cached], 'Planning')).toEqual(['local', 'cached']);
  });

  it('breaks equal search scores by recency then id across refreshes', () => {
    const items = [
      channel('older', 'Planning', NOW - 50 * DAY),
      channel('b', 'Planning', NOW - 40 * DAY),
      channel('a', 'Planning', NOW - 40 * DAY),
    ];
    expect(ids(items, 'Planning')).toEqual(['a', 'b', 'older']);
    expect(ids([...items].reverse(), 'Planning')).toEqual(['a', 'b', 'older']);
  });

  it('retains broader cache subsequences after regular matches without retaining unmatched commands', () => {
    const items = [
      channel('b', 'Quarterly plan'),
      channel('a', 'Quarterly plan'),
      command('unmatched-command', 'Quarterly plan', NOW),
      channel('direct-match', 'Qtr plan', NOW - DAY),
    ];
    expect(ids(items, 'qtr', false)).toEqual(['direct-match']);
    expect(ids(items, 'qtr')).toEqual(['direct-match', 'a', 'b']);
    expect(ids([...items].reverse(), 'qtr')).toEqual([
      'direct-match',
      'a',
      'b',
    ]);
  });

  it('keeps server-matched projects reachable like other server matches', () => {
    const items = [
      project('project', 'Quarterly plan'),
      channel('direct-match', 'Qtr plan', NOW - DAY),
    ];
    expect(ids(items, 'qtr')).toEqual(['direct-match', 'project']);
  });

  it('keeps server-matched people the fuzzy matcher misses, without the cache projection', () => {
    const person: CommandMenuItem = {
      id: 'macro|asher@macro.com',
      kind: 'user',
      bucket: 'person',
      searchText: 'Asher Smith | asher@macro.com',
      sortTimestamp: NOW,
      timestamps: {},
      data: {
        id: 'macro|asher@macro.com',
        email: 'asher@macro.com',
        name: 'Asher Smith',
      },
    };
    const items = [person, channel('unrelated', 'Planning')];
    expect(
      rankCommandSearchItems(items, 'hckrnn', {
        preserveAdditionalEntityMatches: false,
        preservedIds: new Set([person.id]),
      }).map((item) => item.id)
    ).toEqual([person.id]);
  });

  it.each([false, true])(
    'keeps old DMs and people without activity ahead of recent CRM contacts with GraphQL %s',
    (cacheEnabled) => {
      const items = [
        contact('crm', 'Jack Healey'),
        person('jack', 'Jack Smith'),
        channel('dm', 'Jackson Kustec', NOW - 60 * DAY, 'dm'),
      ];

      expect(ids(items, 'jack', cacheEnabled)).toEqual(['dm', 'jack', 'crm']);
      expect(ids([...items].reverse(), 'jack', cacheEnabled)).toEqual([
        'dm',
        'jack',
        'crm',
      ]);
    }
  );

  it('preserves relevance and recency within People groups and other result positions', () => {
    const items = [
      contact('recent-crm', 'Jack CRM', NOW),
      contact('older-crm', 'Jack CRM', NOW - 10 * DAY),
      command('command', 'Jack command', NOW - 5 * DAY),
      channel('document-slot', 'Jack channel', NOW - 15 * DAY),
      person('jack', 'Jack Smith'),
      channel('old-dm', 'Jack old', NOW - 60 * DAY, 'dm'),
      channel('recent-dm', 'Jack recent', NOW - DAY, 'dm'),
    ];

    expect(ids(items, 'jack')).toEqual([
      'recent-dm',
      'old-dm',
      'command',
      'jack',
      'recent-crm',
      'document-slot',
      'older-crm',
    ]);
  });

  it('prioritizes a broader cached DM match over a directly matched CRM contact', () => {
    const items = [
      contact('crm', 'Qtr plan'),
      channel('dm', 'Quarterly plan', NOW - 60 * DAY, 'dm'),
    ];

    expect(ids(items, 'qtr')).toEqual(['dm', 'crm']);
    expect(ids(items, 'qtr', false)).toEqual(['crm']);
  });

  it('prioritizes a preserved server-matched person over a directly matched CRM contact', () => {
    const items = [
      contact('crm', 'Qtr plan'),
      person('jack', 'Quarterly plan'),
    ];

    expect(
      rankCommandSearchItems(items, 'qtr', {
        preserveAdditionalEntityMatches: false,
        preservedIds: new Set(['jack']),
      }).map((item) => item.id)
    ).toEqual(['jack', 'crm']);
  });
});
