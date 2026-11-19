import type { EntityItem, UserItem } from '@core/context/quickAccess';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listOutsidePeopleLast,
  rankCommandSearchItems,
  sameRankInput,
} from './rank-command-search-items';
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

function person(id: string, name: string): UserItem {
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

/** A person the viewer has a direct message with: the people window gives them
 * an interaction time. */
function messagedPerson(id: string, name: string): UserItem {
  return {
    ...person(id, name),
    timestamps: { lastInteraction: new Date(NOW - 3 * DAY) },
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
        ...messagedPerson('person', 'Avery Morgan'),
        searchText: 'Avery Morgan | avery.morgan@example.com',
      },
    ];
    expect(ids(items, 'avery morgan')[0]).toBe('person');

    const create = {
      ...command('create', 'Create', NOW - DAY),
      searchText: 'new make add Create',
    };
    expect(ids([note('plan', 'Create plan'), create], 'create')[0]).toBe(
      'create'
    );
  });

  it.each([
    {
      query: 'settings',
      label: 'Go to Settings',
      names: [
        'Settings: Edit theme button does nothing',
        'Settings page crashes',
        'Make Settings into Modal',
      ],
    },
    {
      query: 'email',
      label: 'Go to Email',
      names: ['Email digest', 'Email campaigns'],
    },
    { query: 'split', label: 'Create new split', names: ['Split screen'] },
  ])(
    'ranks an unused command named $query above recent names that start with it',
    ({ query, label, names }) => {
      const items = [
        ...names.map((name, index) => note(`note-${index}`, name)),
        command('command', label, 0),
      ];
      expect(ids(items, query)[0]).toBe('command');
      expect(ids([...items].reverse(), query)[0]).toBe('command');
    }
  );

  it('keeps an old exact entity name ahead of a recently used command named after it', () => {
    const items = [
      note('starts', 'Settings page crashes'),
      command('tab', 'Go to settings tab 1', 0),
      command('go', 'Go to Settings', NOW),
      note('exact', 'Settings', NOW - 60 * DAY),
    ];
    expect(ids(items, 'settings')).toEqual(['exact', 'go', 'starts', 'tab']);
  });

  it('orders commands named after the query by where the match falls in their label', () => {
    const items = [
      command('create', 'Create event from email', 0),
      command('go', 'Go to Email', 0),
      command('open', 'Open Email', 0),
    ];
    expect(ids(items, 'email')).toEqual(['open', 'go', 'create']);
  });

  it('ranks a command whose word starts with a partial query among names starting with it', () => {
    const items = [
      note('contains', 'Make Settings into Modal'),
      command('go', 'Go to Settings', 0),
      note('starts', 'Settings page crashes', NOW - DAY),
    ];
    expect(ids(items, 'sett')).toEqual(['starts', 'go', 'contains']);
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
    'keeps an old DM, then people without activity, ahead of recent CRM contacts with GraphQL %s',
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
      channel('channel-slot', 'Jack channel', NOW - 15 * DAY),
      person('jack', 'Jackie Smith'),
      channel('old-dm', 'Jack old', NOW - 60 * DAY, 'dm'),
      channel('recent-dm', 'Jack recent', NOW - DAY, 'dm'),
    ];

    expect(ids(items, 'jack')).toEqual([
      'recent-dm',
      'old-dm',
      'channel-slot',
      'command',
      'jack',
      'recent-crm',
      'older-crm',
    ]);
  });

  it('keeps a CRM contact named with the query above a DM that only holds its letters in order', () => {
    const items = [
      contact('crm', 'Qtr plan'),
      channel('dm', 'Quarterly plan', NOW - 60 * DAY, 'dm'),
    ];

    expect(ids(items, 'qtr')).toEqual(['crm', 'dm']);
    expect(ids(items, 'qtr', false)).toEqual(['crm', 'dm']);
  });

  it('keeps a CRM contact named with the query above a server-matched person that only holds its letters in order', () => {
    const items = [
      contact('crm', 'Qtr plan'),
      person('jack', 'Quarterly plan'),
    ];

    expect(
      rankCommandSearchItems(items, 'qtr', {
        preserveAdditionalEntityMatches: false,
        preservedIds: new Set(['jack']),
      }).map((item) => item.id)
    ).toEqual(['crm', 'jack']);
  });

  it('lists a Macro user ahead of an equally matched CRM contact, never a weaker match ahead of a stronger one', () => {
    expect(
      ids(
        [contact('crm', 'Rand Paulson'), person('miranda', 'mirandahaymon')],
        'rand'
      )
    ).toEqual(['crm', 'miranda']);
    expect(
      ids(
        [contact('crm', 'Rand Paulson'), person('randall', 'Randall Moss')],
        'rand'
      )
    ).toEqual(['randall', 'crm']);
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
      'puts the recent full-name DM above an older DM, and DMs above a never-messaged person named only the query with GraphQL %s',
      (cacheEnabled) => {
        const items = [
          shortDm,
          person('person', 'avery'),
          fullNameDm,
          channel('longer-handle', 'avery+1', NOW - 40 * DAY, 'dm'),
        ];
        expect(ids(items, 'avery', cacheEnabled)).toEqual([
          'full-name-dm',
          'short-dm',
          'longer-handle',
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
  it('lists a person the viewer messages before documents and channels that match equally well, and never above a better match', () => {
    const items = [
      channel('prefix-channel', 'jacob-team', NOW),
      note('prefix-note', 'Jacob onboarding', NOW),
      { ...messagedPerson('prefix-person', 'Jacobson Amy'), personOrder: 0 },
      note('exact-note', 'Jacob', NOW - 90 * DAY),
    ];

    expect(ids(items, 'jacob').slice(0, 2)).toEqual([
      'exact-note',
      'prefix-person',
    ]);
  });
  it('leads with teammates and conversations with them among equally good matches only', () => {
    const windowed = (id: string, name: string, personOrder: number) => ({
      ...person(id, name),
      personOrder,
    });
    const teammateDm = {
      ...channel('teammate-dm', 'Jacob Adams', NOW - 40 * DAY, 'dm'),
      data: {
        ...channel('teammate-dm', 'Jacob Adams', NOW - 40 * DAY, 'dm').data,
        participantIds: ['viewer', 'adams'],
      },
    } as EntityItem;
    const items = [
      // The window lists the outside contact first.
      windowed('outside', 'Jacob', 0),
      windowed('teammate', 'Jacob Baker', 1),
      teammateDm,
      windowed('weak-teammate', 'Major Jacobson', 2),
      note('exact-note', 'Jacob', NOW),
    ];
    const order = rankCommandSearchItems(items, 'jacob', {
      preserveAdditionalEntityMatches: true,
      teammateIds: new Set(['teammate', 'adams', 'weak-teammate']),
      viewerId: 'viewer',
    }).map((item) => item.id);

    expect(order.slice(0, 3)).toEqual(
      expect.arrayContaining(['teammate', 'teammate-dm', 'exact-note'])
    );
    expect(order.slice(0, 2).sort()).toEqual(['teammate', 'teammate-dm']);
    // A teammate who matches less well stays below better matches.
    expect(order.indexOf('weak-teammate')).toBeGreaterThan(
      order.indexOf('exact-note')
    );
    // Someone outside the team the viewer never messaged follows every
    // result with a word starting with the query, however exactly they match.
    expect(order.at(-1)).toBe('outside');
  });

  it.each([false, true])(
    'lists people the viewer never messaged after their own results and the people they know, without a team, with GraphQL %s',
    (cacheEnabled) => {
      const windowed = (item: UserItem, personOrder: number): UserItem => ({
        ...item,
        personOrder,
      });
      const items = [
        // The people window lists the never-messaged exact name first.
        windowed(person('stranger-exact', 'macro'), 0),
        windowed(person('stranger-prefix', 'macro.acct1'), 1),
        windowed(messagedPerson('messaged', 'Macro Lee'), 2),
        windowed(person('stranger-later-word', 'Jo Macropoulos'), 3),
        windowed(person('stranger-contains', 'Bigmacro Fan'), 4),
        project('project', 'Macro roadmap', NOW - 20 * DAY),
        channel('channel', 'macro-eng', NOW - 20 * DAY),
        note('later-word-note', 'Notes on macro', NOW),
        note('contains-note', 'Nanomacros', NOW),
      ];
      const order = rankCommandSearchItems(items, 'macro', {
        preserveAdditionalEntityMatches: cacheEnabled,
      }).map((item) => item.id);

      expect(order).toEqual([
        'messaged',
        'channel',
        'project',
        'later-word-note',
        'stranger-exact',
        'stranger-prefix',
        'stranger-later-word',
        'contains-note',
        'stranger-contains',
      ]);
    }
  );

  it.each([false, true])(
    'lists people outside the team after every result from it, people the viewer messages first among them, with GraphQL %s',
    (cacheEnabled) => {
      const windowed = (item: UserItem, personOrder: number): UserItem => ({
        ...item,
        personOrder,
      });
      const items = [
        // The people window lists the never-messaged exact name first.
        windowed(person('stranger-exact', 'macro'), 0),
        windowed(person('stranger-prefix', 'macro.acct1'), 1),
        windowed(messagedPerson('messaged', 'Macro Lee'), 2),
        windowed(person('stranger-later-word', 'Jo Macropoulos'), 3),
        windowed(person('teammate', 'Macroeconomics Club'), 4),
        windowed(person('stranger-contains', 'Bigmacro Fan'), 5),
        project('project', 'Macro roadmap', NOW - 20 * DAY),
        channel('channel', 'macro-eng', NOW - 20 * DAY),
        note('later-word-note', 'Notes on macro', NOW),
        note('contains-note', 'Nanomacros', NOW),
      ];
      const order = rankCommandSearchItems(items, 'macro', {
        preserveAdditionalEntityMatches: cacheEnabled,
        teammateIds: new Set(['teammate']),
      }).map((item) => item.id);

      expect(order).toEqual([
        'teammate',
        'channel',
        'project',
        'later-word-note',
        // A document that only contains the query is still the team's.
        'contains-note',
        'messaged',
        'stranger-exact',
        'stranger-prefix',
        'stranger-later-word',
        'stranger-contains',
      ]);
    }
  );

  it('keeps email-only contacts below a channel and never lifts a person past another result', () => {
    const emailOnly = (id: string, name: string, personOrder: number) => ({
      ...person(id, name),
      data: { id, name, email: `${id}@example.com` },
      personOrder,
    });
    const items = [
      emailOnly('randall', 'Randall Malcom', 0),
      contact('crm', 'Randall Stillwell'),
      emailOnly('miranda', 'mirandahaymon', 1),
      note('script', 'get-random-doc.sh', NOW),
      channel('random', 'random', NOW - 30 * DAY),
    ];

    expect(ids(items, 'rand')).toEqual([
      'random',
      'script',
      'randall',
      'crm',
      'miranda',
    ]);
  });

  it('lists a person the viewer messages, matched by a later word, above a stranger whose name starts with the query', () => {
    const items = [
      person('stranger', 'Leela Okafor'),
      messagedPerson('known', 'Jordan Lee'),
    ];

    expect(ids(items, 'lee')).toEqual(['known', 'stranger']);
  });

  it.each([
    {
      language: 'Japanese',
      label: 'テーマを変更',
      other: 'タスクに移動',
      query: 'テーマ',
    },
    {
      language: 'Simplified Chinese',
      label: '显示/隐藏设置',
      other: '更改主题',
      query: '设置',
    },
    {
      language: 'Traditional Chinese',
      label: '顯示/隱藏設定',
      other: '變更主題',
      query: '設定',
    },
    {
      language: 'Korean',
      label: '테마 변경',
      other: '설정 열기/닫기',
      query: '테마 변경',
    },
    {
      language: 'Russian',
      label: 'Сменить тему',
      other: 'Показать/скрыть настройки',
      query: 'сменить тему',
    },
    {
      language: 'Hindi',
      label: 'थीम बदलें',
      other: 'सेटिंग खोलें/बंद करें',
      query: 'थीम बदलें',
    },
    { language: 'Thai', label: 'เปลี่ยนธีม', other: 'เปิด/ปิดการตั้งค่า', query: 'ธีม' },
  ])(
    'finds a command by its $language name and only that command',
    ({ label, other, query }) => {
      const items = [
        command('other', other, NOW),
        command('command', label, 0),
      ];
      expect(ids(items, query)).toEqual(['command']);
    }
  );

  it('finds a document by several words of a Cyrillic name', () => {
    const items = [
      note('report', 'Отчёт за квартал'),
      note('other', 'План запуска'),
    ];
    expect(ids(items, 'отчёт квартал', false)).toEqual(['report']);
  });
});

describe('people outside the team', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  const VIEWER = 'viewer';
  const TEAM = new Set([VIEWER, 'adams', 'baker', 'macro|lena@example.com']);

  function dm(id: string, name: string, participantIds: string[]): EntityItem {
    const row = channel(id, name, NOW - DAY, 'dm');
    if (row.data.type !== 'channel') throw new Error('not a channel');
    return { ...row, data: { ...row.data, participantIds } };
  }

  function rank(items: CommandMenuItem[], query: string, preserved?: string[]) {
    return rankCommandSearchItems(items, query, {
      preserveAdditionalEntityMatches: true,
      preservedIds: preserved ? new Set(preserved) : undefined,
      teammateIds: TEAM,
      viewerId: VIEWER,
    }).map((item) => item.id);
  }

  it('lists every result from the team before anyone outside it, however well they match', () => {
    const items = [
      { ...person('outside-exact', 'Jacob'), personOrder: 0 },
      contact('outside-crm', 'Jacob Diaz'),
      dm('outside-dm', 'Jacob Rivera', [VIEWER, 'rivera']),
      { ...person('adams', 'Jacob Adams'), personOrder: 1 },
      channel('channel', 'jacob-team', NOW - 30 * DAY),
      // A group conversation is the viewer's, whoever else is in it.
      dm('group-dm', 'Jacob Rivera, Jacob Adams', [VIEWER, 'rivera', 'adams']),
      // Only contains the query: still the team's.
      note('contains-note', 'Ajacobs plan', NOW - 90 * DAY),
    ];
    const order = rank(items, 'jacob');
    const firstOutside = Math.min(
      order.indexOf('outside-exact'),
      order.indexOf('outside-crm'),
      order.indexOf('outside-dm')
    );

    expect(order.slice(0, firstOutside).sort()).toEqual(
      ['adams', 'channel', 'contains-note', 'group-dm'].sort()
    );
    // Among people outside the team, the one the viewer messages leads.
    expect(order.slice(firstOutside)).toEqual([
      'outside-dm',
      'outside-exact',
      'outside-crm',
    ]);
  });

  it('keeps the team’s server-matched rows ahead of people outside the team', () => {
    const items = [
      { ...person('outside', 'Jacob Diaz'), personOrder: 0 },
      // Matched by the server, not by the menu's own matcher.
      note('server-note', 'Quarterly plan', NOW - 60 * DAY),
      { ...person('baker', 'Sam Baker'), personOrder: 1 },
    ];

    expect(rank(items, 'jacob', ['baker'])).toEqual([
      'server-note',
      'baker',
      'outside',
    ]);
  });

  it('keeps window people the menu’s matcher leaves out on their own side of the team', () => {
    const items = [
      // The people search matched these two by an alias or by words in
      // another order; the menu's own matcher does not.
      { ...person('outside', 'Jordan Lee'), personOrder: 0 },
      { ...person('adams', 'Jacob Adams'), personOrder: 1 },
      { ...person('baker', 'Baker Sam'), personOrder: 2 },
      note('note', 'Baker Sam onboarding', NOW - DAY),
    ];

    expect(rank(items, 'baker sam')).toEqual([
      'baker',
      'adams',
      'note',
      'outside',
    ]);
    expect(
      rank(
        [
          ...items,
          { ...person('outside-sam', 'Baker Samuels'), personOrder: 3 },
        ],
        'baker sam'
      )
    ).toEqual(['baker', 'adams', 'note', 'outside-sam', 'outside']);
  });

  it('counts a CRM contact with a teammate’s email address as the teammate', () => {
    const items = [
      { ...person('outside', 'Lena Park'), personOrder: 0 },
      contact('lena', 'Lena Ortiz'),
      note('note', 'Lena onboarding', NOW - 90 * DAY),
    ];

    expect(rank(items, 'lena')).toEqual(['lena', 'note', 'outside']);
  });

  it('keeps someone outside the team among the team’s results when the query is their full name or email address', () => {
    const outsideAdams = {
      ...person('outside-adams', 'Jacob Adams'),
      searchText: 'Jacob Adams | jacob.adams@example.com',
      data: {
        id: 'outside-adams',
        name: 'Jacob Adams',
        email: 'jacob.adams@example.com',
      },
    };
    const items = [
      { ...outsideAdams, personOrder: 0 },
      { ...person('outside-other', 'Jacob Adamson'), personOrder: 1 },
      { ...person('adams', 'Jacob Adams'), personOrder: 2 },
      note('note', 'Jacob Adams intro call', NOW),
      // Matched by the server, not by the menu's own matcher.
      note('server-note', 'Quarterly plan', NOW - DAY),
    ];

    // The namesake outside the team ranks as a stranger among the team's
    // results: after the teammate and the document whose words start with
    // the name, before the team's server matches.
    expect(rank(items, 'jacob adams')).toEqual([
      'adams',
      'note',
      'outside-adams',
      'server-note',
      'outside-other',
    ]);
    expect(rank(items, 'jacob.adams@example.com')[0]).toBe('outside-adams');
    // One word is a first name many people share: no exception.
    expect(rank(items, 'jacob')).toEqual([
      'adams',
      'note',
      'server-note',
      'outside-adams',
      'outside-other',
    ]);
  });

  it('ranks an exactly named person outside the team as a stranger, even one the viewer messages', () => {
    const items = [
      dm('outside-dm', 'Jacob Adams', [VIEWER, 'other-adams']),
      messagedPerson('outside-person', 'Jacob Adams'),
      note('note', 'Jacob Adams onboarding', NOW - 30 * DAY),
      note('contains-note', 'Bjacob adamsplan', NOW),
    ];

    expect(rank(items, 'jacob adams')).toEqual([
      'note',
      'outside-dm',
      'outside-person',
      'contains-note',
    ]);
  });

  it('changes nothing while the roster is unknown or the viewer has no team', () => {
    const items = [
      dm('outside-dm', 'Jacob Rivera', [VIEWER, 'rivera']),
      note('contains-note', 'Ajacobs plan', NOW),
    ];

    expect(
      rankCommandSearchItems(items, 'jacob', {
        preserveAdditionalEntityMatches: true,
        teammateIds: new Set(),
        viewerId: VIEWER,
      }).map((item) => item.id)
    ).toEqual(['outside-dm', 'contains-note']);
  });

  it('lists people outside the team last in the list shown before typing', () => {
    const items = [
      dm('outside-dm', 'Jacob Rivera', [VIEWER, 'rivera']),
      channel('channel', 'general'),
      dm('teammate-dm', 'Sam Baker', [VIEWER, 'baker']),
      contact('outside-crm', 'Jacob Diaz'),
      command('recent-command', 'Create doc', NOW),
      dm('group-dm', 'Jacob Rivera, Sam Baker', [VIEWER, 'rivera', 'baker']),
      note('note', 'Plan'),
      // A command used before the last DM is still one of the team's rows.
      command('older-command', 'Open settings', NOW - 2 * DAY),
      dm('older-outside-dm', 'Jordan Lee', [VIEWER, 'lee']),
      // The command catalog follows the recent rows. Go To commands are
      // listed after the others, so a used one can follow never-used ones.
      command('catalog-a', 'Create task', 0),
      command('catalog-go-to', 'Go to Tasks', NOW - 3 * DAY),
      command('catalog-b', 'Go to Home', 0),
    ];
    const team = { teammateIds: TEAM, viewerId: VIEWER };

    expect(listOutsidePeopleLast(items, team).map((item) => item.id)).toEqual([
      'channel',
      'teammate-dm',
      'recent-command',
      'group-dm',
      'note',
      'older-command',
      'outside-dm',
      'outside-crm',
      'older-outside-dm',
      'catalog-a',
      'catalog-go-to',
      'catalog-b',
    ]);
    expect(
      listOutsidePeopleLast(items, { viewerId: VIEWER }).map((item) => item.id)
    ).toEqual(items.map((item) => item.id));
  });
});

describe('sameRankInput', () => {
  it('treats new objects holding the same rows in the same order as unchanged', () => {
    expect(
      sameRankInput(
        [channel('a', 'Alpha'), channel('b', 'Beta')],
        [channel('a', 'Alpha'), channel('b', 'Beta')]
      )
    ).toBe(true);
  });

  it('sees a reorder, a removed row, a renamed row and a newer view', () => {
    const previous = [channel('a', 'Alpha'), channel('b', 'Beta')];

    expect(
      sameRankInput(previous, [channel('b', 'Beta'), channel('a', 'Alpha')])
    ).toBe(false);
    expect(sameRankInput(previous, [channel('a', 'Alpha')])).toBe(false);
    expect(
      sameRankInput(previous, [channel('a', 'Alpha'), channel('b', 'Gamma')])
    ).toBe(false);
    expect(
      sameRankInput(previous, [
        channel('a', 'Alpha'),
        channel('b', 'Beta', NOW + DAY),
      ])
    ).toBe(false);
  });

  it('keeps a command only when it is the same object', () => {
    const open = command('open', 'Open', NOW);

    expect(sameRankInput([open], [open])).toBe(true);
    expect(sameRankInput([open], [command('open', 'Open', NOW)])).toBe(false);
  });
});
