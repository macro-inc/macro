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
    kind: 'entity',
    bucket: 'initiative',
    searchText: name,
    sortTimestamp: updatedAt,
    timestamps: { updatedAt: new Date(updatedAt).toISOString() },
    data: { id, type: 'initiative', name, ownerId: 'owner' },
  };
}

function note(id: string, name: string, viewedAt = NOW): EntityItem {
  return {
    id,
    kind: 'entity',
    bucket: 'note',
    searchText: name,
    sortTimestamp: viewedAt,
    timestamps: { viewedAt: new Date(viewedAt) },
    data: { id, type: 'document', name, ownerId: 'owner', fileType: 'md' },
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
    'prioritizes channels over commands and keeps their viewed recency with GraphQL %s',
    (cacheEnabled) => {
      const items = [
        channel('old-channel', 'Planning', NOW - 20 * DAY),
        command('command', 'Planning', NOW - DAY),
        channel('recent-channel', 'Planning', NOW),
      ];
      expect(ids(items, 'Planning', cacheEnabled)).toEqual([
        'recent-channel',
        'old-channel',
        'command',
      ]);
    }
  );

  it('reranks dynamic command descriptions without replacing rows', () => {
    let description = 'Create';
    const items: CommandMenuItem[] = [
      {
        id: 'dynamic-command',
        kind: 'command',
        bucket: 'command',
        searchText: 'create make',
        sortTimestamp: NOW,
        timestamps: { viewedAt: new Date(NOW) },
        data: {
          description: () => description,
          scopeId: 'command-menu',
          runWithInputFocused: true,
        },
      },
      note('plan', 'Create plan'),
    ];
    expect(ids(items, 'create')).toEqual(['dynamic-command', 'plan']);
    description = 'Make';
    expect(ids(items, 'create')).toEqual(['plan', 'dynamic-command']);
  });

  it('keeps commands and other entities ordered by recency', () => {
    expect(
      ids(
        [
          project('old-project', 'Planning', NOW - 20 * DAY),
          command('command', 'Planning', NOW - DAY),
          project('recent-project', 'Planning', NOW),
        ],
        'Planning'
      )
    ).toEqual(['recent-project', 'command', 'old-project']);
  });

  it.each([false, true])(
    'ranks an exact project name above recently viewed documents that contain it with GraphQL %s',
    (cacheEnabled) => {
      const items = [
        note('scattered', 'Launch: share the updated plan with partners'),
        note('retro', 'Team launch plan retro'),
        note('review', 'Launch plan review notes'),
        project('project', 'Launch plan', NOW - 20 * DAY),
      ];
      expect(ids(items, 'launch plan', cacheEnabled).slice(0, 2)).toEqual([
        'project',
        'review',
      ]);
    }
  );

  it('scores exact names against the label when search text adds emails or command keywords', () => {
    const items = [
      note('notes', 'Avery Morgan notes'),
      {
        ...contact('contact', 'Avery Morgan'),
        searchText: 'Avery Morgan | avery.morgan@example.com',
      },
    ];
    expect(ids(items, 'avery morgan')[0]).toBe('contact');

    const create = {
      ...command('create', 'Create', NOW - DAY),
      searchText: 'new make add Create',
    };
    expect(ids([note('plan', 'Create plan'), create], 'create')[0]).toBe(
      'create'
    );
  });

  it('ranks an exact project name above a recently viewed channel that starts with it', () => {
    const items = [
      channel('channel', 'Launch plan rollout'),
      project('project', 'Launch plan', NOW - 20 * DAY),
    ];
    expect(ids(items, 'launch plan')).toEqual(['project', 'channel']);
  });

  it('keeps ranking independent of whether a match came from cached or local results', () => {
    const cached = channel('cached', 'Planning', NOW - DAY);
    const local = channel('local', 'Planning', NOW);
    expect(ids([cached, local], 'Planning')).toEqual(['local', 'cached']);
    expect(ids([local, cached], 'Planning')).toEqual(['local', 'cached']);
  });

  it.each([
    { cacheEnabled: false, query: 'planning' },
    { cacheEnabled: true, query: 'planning' },
    { cacheEnabled: false, query: 'planning notes' },
    { cacheEnabled: true, query: 'planning notes' },
  ])(
    'keeps an old channel ahead of recent contacts and agents for $query with GraphQL $cacheEnabled',
    ({ cacheEnabled, query }) => {
      const session: EntityItem = {
        id: 'session',
        kind: 'entity',
        bucket: 'agent_session',
        searchText: 'Review planning notes Assistant',
        sortTimestamp: NOW,
        timestamps: { updatedAt: new Date(NOW) },
        data: {
          id: 'session',
          type: 'agent_session',
          name: 'Review planning notes',
          ownerId: 'owner',
          botId: 'assistant',
          status: 'completed',
        },
      };
      const items = [
        session,
        contact('crm', 'Planning notes coordinator'),
        channel('channel', 'Planning notes', NOW - 60 * DAY),
      ];
      expect(ids(items, query, cacheEnabled)[0]).toBe('channel');
      expect(ids([...items].reverse(), query, cacheEnabled)[0]).toBe('channel');
    }
  );

  it('keeps full-name DMs ahead of other results when aliases extend their search text', () => {
    const dm = {
      ...channel('dm', 'Avery Morgan', NOW - 60 * DAY, 'dm'),
      searchText:
        'Avery Morgan | Avery Morgan | avery.morgan@example.com | Avery Morgan | avery.morgan@example.com',
    };
    expect(
      ids([project('project', 'Avery Morgan'), dm], 'avery morgan')
    ).toEqual(['dm', 'project']);
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

  it('uses the same per-row subsequences for cached/local entities without widening command keywords', () => {
    const items = [
      channel('b', 'Quarterly plan'),
      channel('a', 'Quarterly plan'),
      command('unmatched-command', 'Quarterly plan', NOW),
      channel('direct-match', 'Qtr plan', NOW - DAY),
    ];
    expect(ids(items, 'qtr', false)).toEqual(['direct-match', 'a', 'b']);
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

      expect(ids(items, 'jack', cacheEnabled)).toEqual(['jack', 'dm', 'crm']);
      expect(ids([...items].reverse(), 'jack', cacheEnabled)).toEqual([
        'jack',
        'dm',
        'crm',
      ]);
    }
  );

  it('preserves relevance and recency within People groups and other result positions', () => {
    const items = [
      contact('recent-crm', 'Jack CRM', NOW),
      contact('older-crm', 'Jack CRM', NOW - 10 * DAY),
      command('command', 'Jack command', NOW - 5 * DAY),
      channel('channel-slot', 'Jack channel', NOW - 15 * DAY),
      person('jack', 'Jackie Smith'),
      channel('old-dm', 'Jack old', NOW - 60 * DAY, 'dm'),
      channel('recent-dm', 'Jack recent', NOW - DAY, 'dm'),
    ];

    expect(ids(items, 'jack')).toEqual([
      'recent-dm',
      'old-dm',
      'jack',
      'channel-slot',
      'recent-crm',
      'command',
      'older-crm',
    ]);
  });

  it('prioritizes a broader cached DM match over a directly matched CRM contact', () => {
    const items = [
      contact('crm', 'Qtr plan'),
      channel('dm', 'Quarterly plan', NOW - 60 * DAY, 'dm'),
    ];

    expect(ids(items, 'qtr')).toEqual(['dm', 'crm']);
    expect(ids(items, 'qtr', false)).toEqual(['dm', 'crm']);
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

  describe('participant names in any order', () => {
    const pair = channel('pair', 'Avery Morgan, Blair Chen', NOW - 20 * DAY);
    const group = channel(
      'group',
      'Casey Reed, Avery Morgan, Blair Chen, Drew Fox',
      NOW
    );

    it.each([
      'Avery, Blair',
      'Blair, Avery',
      'blair avery',
      'Blair, aver',
      'chen, morgan',
      'Blair Chen, Avery Morgan',
    ])('ranks the exact pair above a newer larger group for %s', (query) => {
      expect(ids([group, pair], query, true)).toEqual(['pair', 'group']);
      expect(ids([group, pair], query, false)).toEqual(['pair', 'group']);
    });

    it('ranks the exact pair above a note and a project that loosely match', () => {
      const items = [
        note('note', 'Blair and Avery kickoff'),
        project('project', 'Avery Blair launch'),
        pair,
      ];
      expect(ids(items, 'Blair, Avery')[0]).toBe('pair');
    });

    it('does not treat a query that leaves a participant unnamed as the exact pair', () => {
      const items = [note('note', 'Blair Chen notes'), pair];
      expect(ids(items, 'blair chen')).toEqual(['note', 'pair']);
    });

    it('does not let one term name every participant whose name starts with it', () => {
      const items = [
        channel('namesakes', 'Avery Morgan, Avery Chen'),
        project('project', 'Avery', NOW - 20 * DAY),
      ];
      expect(ids(items, 'avery')).toEqual(['project', 'namesakes']);
    });

    it('keeps a recent group of namesakes below a DM with only one of them', () => {
      const items = [
        channel('namesakes', 'Avery Morgan, Avery Chen'),
        channel('dm', 'Avery Morgan', NOW - 60 * DAY, 'dm'),
      ];
      expect(ids(items, 'avery morgan')).toEqual(['dm', 'namesakes']);
    });

    it('matches namesakes when each has a term of their own', () => {
      const items = [
        channel('namesakes', 'Avery Morgan, Avery Chen', NOW - 20 * DAY),
        channel('group', 'Casey Reed, Avery Morgan, Avery Chen'),
      ];
      expect(ids(items, 'avery, morgan')).toEqual(['namesakes', 'group']);
    });

    it('reassigns a term when a later participant has no other', () => {
      const group = channel('group', 'Avery Morgan, Avery Chen');
      expect(ids([group], 'avery, chen', false)).toEqual(['group']);
      expect(
        ids([note('note', 'Avery chen plan'), group], 'avery, chen')[0]
      ).toBe('group');
    });

    it('answers a long pasted query quickly on a large group', () => {
      const people = Array.from({ length: 12 }, (_, index) =>
        index === 11 ? 'Zane Young' : `Avery Person${index}`
      );
      const group = channel('group', people.join(', '));
      const started = performance.now();
      ids([group], Array.from({ length: 12 }, () => 'avery').join(' '), false);
      expect(performance.now() - started).toBeLessThan(250);
    });

    it('finds a one-to-one DM by its name reversed', () => {
      const dm = channel('dm', 'Avery Morgan', NOW, 'dm');
      expect(ids([dm], 'morgan avery', false)).toEqual(['dm']);
    });
  });

  describe('people matched by first name', () => {
    const shortDm = channel('short-dm', 'Avery', NOW - 60 * DAY, 'dm');
    const fullNameDm = channel('full-name-dm', 'Avery Morgan', NOW, 'dm');

    it.each([false, true])(
      'puts the recent full-name DM above an older DM and a person named only the query with GraphQL %s',
      (cacheEnabled) => {
        const items = [
          shortDm,
          person('person', 'avery'),
          fullNameDm,
          channel('longer-handle', 'avery+1', NOW - 40 * DAY, 'dm'),
        ];
        expect(ids(items, 'avery', cacheEnabled).slice(0, 3)).toEqual([
          'full-name-dm',
          'short-dm',
          'person',
        ]);
      }
    );

    it('keeps a group DM out of the first-name group', () => {
      const items = [
        channel('group-dm', 'Avery Morgan, Blair Chen', NOW, 'dm'),
        channel('one-to-one', 'Avery Morgan', NOW - 60 * DAY, 'dm'),
      ];
      expect(ids(items, 'avery')).toEqual(['one-to-one', 'group-dm']);
    });

    it('keeps the more recently viewed DM first when the short name is the active one', () => {
      expect(
        ids(
          [
            channel('short-dm', 'Avery', NOW, 'dm'),
            channel('full-name-dm', 'Avery Morgan', NOW - 2 * DAY, 'dm'),
          ],
          'avery'
        )
      ).toEqual(['short-dm', 'full-name-dm']);
    });

    it('puts a first-name DM above a project named exactly the query', () => {
      const items = [project('project', 'Avery', NOW), fullNameDm];
      expect(ids(items, 'avery')).toEqual(['full-name-dm', 'project']);
    });

    it('keeps other rows and partial first names in the prefix group', () => {
      const items = [
        project('exact-project', 'Avery', NOW - 20 * DAY),
        note('first-word-note', 'Avery Morgan'),
        fullNameDm,
      ];
      expect(ids(items, 'aver')).toEqual([
        'full-name-dm',
        'first-word-note',
        'exact-project',
      ]);
      expect(ids(items.slice(0, 2), 'avery')).toEqual([
        'exact-project',
        'first-word-note',
      ]);
    });
  });
  it('ranks rows containing the typed word above rows that only contain its letters', () => {
    const items = [
      note('scattered', 'Jan catch-up notes on billing', NOW),
      note('word', 'Major Jacob review', NOW - 20 * DAY),
    ];

    expect(ids(items, 'jacob')).toEqual(['word', 'scattered']);
  });

  it('keeps window order among equal name matches without lifting a weaker person above exact names', () => {
    const windowed = (id: string, name: string, personOrder: number) => ({
      ...person(id, name),
      personOrder,
    });
    const items = [
      channel('exact-channel', 'jacob', NOW - 30 * DAY),
      note('exact-note', 'Jacob', NOW - 30 * DAY),
      // The window lists the most recent contact first.
      windowed('major', 'Major Jacob', 0),
      windowed('baker', 'Jacob Baker', 1),
      windowed('adams', 'Jacob Adams', 2),
    ];

    const order = ids(items, 'jacob');
    expect(order).toHaveLength(5);
    expect(order.indexOf('baker')).toBeLessThan(order.indexOf('adams'));
    expect(order.indexOf('adams')).toBeLessThan(order.indexOf('major'));
    expect(order.indexOf('exact-channel')).toBeLessThan(order.indexOf('major'));
    expect(order.indexOf('exact-note')).toBeLessThan(order.indexOf('major'));
  });
  it('lists a person before documents and channels that match equally well, and never above a better match', () => {
    const items = [
      channel('prefix-channel', 'jacob-team', NOW),
      note('prefix-note', 'Jacob onboarding', NOW),
      { ...person('prefix-person', 'Jacobson Amy'), personOrder: 0 },
      note('exact-note', 'Jacob', NOW - 90 * DAY),
    ];

    expect(ids(items, 'jacob').slice(0, 2)).toEqual([
      'exact-note',
      'prefix-person',
    ]);
  });
});
