import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isUnfinishedSearchOperator,
  readSearchOperators,
  searchOperatorIndexes,
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
    ['from:ana', false],
    ['tag:fin', false],
    ['type:tasks', false],
    ['launch', false],
  ])('%s: %s', (term, unfinished) => {
    expect(isUnfinishedSearchOperator(term)).toBe(unfinished);
  });
});
