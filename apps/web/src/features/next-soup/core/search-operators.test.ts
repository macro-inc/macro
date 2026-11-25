import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isUnfinishedSearchOperator,
  leavesOutName,
  readSearchOperators,
  searchBindingsIn,
  searchOperatorIndexes,
  searchOperatorSpans,
  searchQueryParts,
  splitSearchTerms,
} from './search-operators';

type TypedQuery = { typed: string; operators: number };

// The search service's tests read the same cases, so the field reads exactly
// the operators the service reads.
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../..'
);
const TYPED_QUERIES: TypedQuery[] = JSON.parse(
  readFileSync(
    resolve(
      repositoryRoot,
      'crates/search_service/src/api/search/search_operators/typed_operators.json'
    ),
    'utf8'
  )
);

const read = (query: string, reachesChannels = true) =>
  readSearchOperators(splitSearchTerms(query), reachesChannels);

describe('readSearchOperators', () => {
  it.each(TYPED_QUERIES)('$typed: $operators', ({ typed, operators }) => {
    expect(read(typed).operators).toBe(operators);
  });

  it('leaves the words around operators in order, dropping an OR that joins nothing', () => {
    expect(read('launch type:task OR notes tag:a OR').terms).toEqual([
      'launch',
      'notes',
    ]);
    expect(read('tea OR coffee').terms).toEqual(['tea', 'OR', 'coffee']);
  });

  it('joins values with OR and keeps repeated operators apart', () => {
    const joined = read('tag:finance OR tag:legal');
    expect(joined.groups).toHaveLength(1);
    expect(joined.groups[0]?.values).toEqual([
      { kind: 'name', name: 'finance' },
      { kind: 'name', name: 'legal' },
    ]);
    expect(read('tag:finance tag:legal').groups).toHaveLength(2);
  });

  it('reads a person as me or the user an address names', () => {
    expect(read('assignee:me').groups[0]?.values).toEqual([
      { kind: 'person', person: { me: true } },
    ]);
    expect(read('author:Ana@Example.com').groups[0]?.values).toEqual([
      {
        kind: 'person',
        person: { me: false, userId: 'macro|ana@example.com' },
      },
    ]);
  });

  it('leaves in:# to Mail where the search or its other operators reach no channel', () => {
    expect(read('in:#travel lunch', false).terms).toContain('in:#travel');
    expect(read('type:email in:#travel lunch').terms).toContain('in:#travel');
    expect(read('inbox:ana@example.com in:#travel').terms).toContain(
      'in:#travel'
    );
    expect(read('in:#launch notes').terms).toEqual(['notes']);
  });
});

describe('splitSearchTerms', () => {
  it('splits by whitespace outside quotes and drops the quotes', () => {
    expect(
      splitSearchTerms('tag:"team offsite"  in:#“q3 launch” notes')
    ).toEqual(['tag:team offsite', 'in:#q3 launch', 'notes']);
  });
});

describe('searchOperatorIndexes', () => {
  it('names the types the operators leave', () => {
    expect(searchOperatorIndexes(read('status:in_progress launch'))).toEqual([
      'task',
    ]);
    expect(searchOperatorIndexes(read('type:doc author:me launch'))).toEqual([
      'document-or-file',
    ]);
    expect(
      searchOperatorIndexes(read('type:channel OR type:call from:me launch'))
    ).toEqual(['channels', 'calls']);
    expect(searchOperatorIndexes(read('tag:finance launch'))).not.toContain(
      'channels'
    );
    expect(searchOperatorIndexes(read('type:task type:email'))).toEqual([]);
  });
});

describe('searchQueryParts', () => {
  it('sends the service the query once it has a word, holding back half-typed operators', () => {
    expect(searchQueryParts('launch status:').serviceText).toBe('launch');
    expect(searchQueryParts('launch type:ta').serviceText).toBe('launch');
    expect(searchQueryParts('"q3 plan" tag:finance').serviceText).toBe(
      '"q3 plan" tag:finance'
    );
  });

  it('sends nothing when only operators are left, for the view to list', () => {
    const parts = searchQueryParts('assignee:me status:in_progress');
    expect(parts.serviceText).toBe('');
    expect(parts.read.operators).toBe(2);
  });

  it('needs a word with a letter or digit, as the service drops the rest', () => {
    expect(searchQueryParts('assignee:me -').serviceText).toBe('');
    expect(searchQueryParts('tag:finance 🎉').serviceText).toBe('');
    expect(searchQueryParts('status:in_progress &').serviceText).toBe('');
    expect(searchQueryParts('status:in_progress & launch').serviceText).toBe(
      'status:in_progress & launch'
    );
  });

  it('leaves out the words a minus names and waits for a word beside them', () => {
    const beside = searchQueryParts('budget -draft -"team lunch"');
    expect(beside.serviceText).toBe('budget -draft -"team lunch"');
    expect(beside.nameText).toBe('budget');
    expect(beside.leftOutWords).toEqual(['draft', 'team lunch']);
    expect(beside.waitsForWord).toBe(false);

    expect(searchQueryParts('-draft').waitsForWord).toBe(true);
    expect(searchQueryParts('-draft').nameText).toBe('');
    expect(searchQueryParts('type:doc -draft').waitsForWord).toBe(true);
    // Mail's search runs on the words it leaves out alone.
    expect(searchQueryParts('type:email -draft').waitsForWord).toBe(false);
    expect(searchQueryParts('from:ana -draft').waitsForWord).toBe(false);

    const words = searchQueryParts('e-mail --force');
    expect(words.leftOutWords).toEqual([]);
    expect(words.nameText).toBe('e-mail --force');
    expect(words.waitsForWord).toBe(false);
  });

  it('leaves out a name holding a word a minus names, ignoring case', () => {
    expect(leavesOutName('Budget Draft v2', ['draft'])).toBe(true);
    expect(leavesOutName('Q3 redrafts', ['DRAFT'])).toBe(true);
    expect(leavesOutName('Budget plan', ['draft'])).toBe(false);
    expect(leavesOutName('Budget plan', [])).toBe(false);
  });

  it('sends bound tokens with the request by id, not in the service’s text', () => {
    const bindings = [
      { token: 'tag:🔥', tags: [{ propertyId: 'tags-1', optionId: 'fire-1' }] },
      { token: 'in:#"Ana Lima"', channelIds: ['dm-ana'] },
    ];
    const parts = searchQueryParts(
      'type:channel in:#"Ana Lima" budget',
      bindings
    );
    expect(parts.serviceText).toBe('type:channel budget');
    expect(parts.bound.groups.map((group) => group.terms)).toEqual([
      ['in:#Ana Lima'],
    ]);

    const alone = searchQueryParts('tag:🔥', bindings);
    expect(alone.serviceText).toBe('');
    expect(alone.read.operators).toBe(1);

    // An `OR` left beside a bound token isn't a word to the service.
    expect(searchQueryParts('budget tag:🔥 OR', bindings).serviceText).toBe(
      'budget'
    );
    expect(searchQueryParts('budget OR tag:🔥', bindings).serviceText).toBe(
      'budget'
    );

    // Edited, a token is read as typed.
    expect(searchQueryParts('in:#"Ana Lim" budget', bindings).serviceText).toBe(
      'in:#"Ana Lim" budget'
    );
  });

  it('reads Mail’s operators as words where email isn’t searched', () => {
    expect(searchQueryParts('type:task newer_than:2 roadmap').serviceText).toBe(
      'type:task newer_than:2 roadmap'
    );
    expect(searchQueryParts('newer_than:2 roadmap').serviceText).toBe(
      'roadmap'
    );
    expect(searchQueryParts('type:task subject:roadmap').nameText).toBe(
      'subject:roadmap'
    );
  });

  it('reads two bindings of one token as the ids of both', () => {
    const parts = searchQueryParts('tag:work', [
      {
        token: 'tag:work',
        tags: [{ propertyId: 'set-1', optionId: 'work-1' }],
      },
      {
        token: 'tag:work',
        tags: [{ propertyId: 'set-2', optionId: 'work-2' }],
      },
    ]);
    expect(parts.read.groups[0]?.values).toEqual([
      {
        kind: 'tags',
        tags: [
          { propertyId: 'set-1', optionId: 'work-1' },
          { propertyId: 'set-2', optionId: 'work-2' },
        ],
      },
    ]);
  });

  it('keeps only the bindings whose token is still in the text', () => {
    const bindings = [
      { token: 'tag:🔥', tags: [{ propertyId: 'tags-1', optionId: 'fire-1' }] },
      { token: 'in:#"Ana Lima"', channelIds: ['dm-ana'] },
    ];
    expect(searchBindingsIn('in:#"Ana Lima" budget', bindings)).toEqual([
      bindings[1],
    ]);
    expect(searchBindingsIn('', bindings)).toEqual([]);
  });

  it('keeps email operators for the service, which reads them alone', () => {
    expect(searchQueryParts('is:unread').serviceText).toBe('is:unread');
  });

  it('matches names with the words beside type: alone', () => {
    expect(searchQueryParts('type:task launch').nameText).toBe('launch');
    expect(searchQueryParts('status:in_progress launch').nameText).toBe('');
    expect(searchQueryParts('subject:lunch notes').nameText).toBe('');
  });
});

describe('isUnfinishedSearchOperator', () => {
  it.each([
    ['status:', true],
    ['type:ta', true],
    ['in:#', true],
    ['assignee:ana@', true],
    ['author:an', true],
    ['inbox:ana@', true],
    ['assignee:me', false],
    ['assignee:ana@example', true],
    ['from:ana', false],
    ['tag:fin', false],
    ['type:tasks', false],
    ['launch', false],
  ])('%s: %s', (term, unfinished) => {
    expect(isUnfinishedSearchOperator(term)).toBe(unfinished);
  });
});

describe('searchOperatorSpans', () => {
  const drawn = (text: string) =>
    searchOperatorSpans(text).map(({ start, end }) => text.slice(start, end));

  it('marks whole operators, the service’s and Mail’s', () => {
    expect(drawn('launch type:task tag:"q3 plan"')).toEqual([
      'type:task',
      'tag:"q3 plan"',
    ]);
    expect(drawn('launch is:unread from:ana')).toEqual([
      'is:unread',
      'from:ana',
    ]);
    expect(drawn('tag:finance OR tag:legal')).toEqual([
      'tag:finance',
      'tag:legal',
    ]);
  });

  it('draws a bound token as an operator', () => {
    // A tag named with ASCII punctuation alone reads as a word when typed.
    const bindings = [
      { token: 'tag:--', tags: [{ propertyId: 'tags-1', optionId: 'dash-1' }] },
    ];
    expect(
      searchOperatorSpans('launch tag:--', bindings).map(({ start, end }) =>
        'launch tag:--'.slice(start, end)
      )
    ).toEqual(['tag:--']);
    expect(drawn('launch tag:--')).toEqual([]);
  });

  it('reads a tag or channel named by an emoji alone', () => {
    expect(drawn('launch tag:🔥 in:#🚀')).toEqual(['tag:🔥', 'in:#🚀']);
    expect(drawn('launch tag:- in:#-')).toEqual([]);
  });

  it('draws an operator the rest of the query lets it be', () => {
    expect(drawn('type:channel from:me roadmap')).toEqual([
      'type:channel',
      'from:me',
    ]);
  });

  it('leaves Mail’s operators plain where email isn’t searched', () => {
    expect(drawn('type:task is:unread')).toEqual(['type:task']);
  });

  it('leaves words, invalid values and half-typed operators plain', () => {
    expect(drawn('type:tasks status: assignee:ana@ launch')).toEqual([]);
  });
});
