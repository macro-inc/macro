import { describe, expect, it } from 'vitest';
import {
  type SearchOperatorValues,
  searchOperatorCompletions,
} from './search-operator-completions';

const VALUES: SearchOperatorValues = {
  people: [{ email: 'ana@example.com', name: 'Ana Lima' }],
  tags: ['Finance', 'Team offsite', 'Travel'],
  inboxes: ['me@example.com', 'team@example.com'],
  channels: ['launch', 'Q3 launch'],
};

const inserts = (text: string) =>
  searchOperatorCompletions(text, VALUES).map((row) => row.insert);

describe('searchOperatorCompletions', () => {
  it('offers operator names for a word that starts one', () => {
    expect(inserts('launch ty')).toEqual(['type:']);
    expect(inserts('in')).toEqual(['inbox:', 'in:']);
    expect(inserts('launch t')).toEqual([]);
    expect(inserts('launch ')).toEqual([]);
  });

  it('offers the values an operator takes', () => {
    expect(inserts('type:ta')).toEqual(['type:task']);
    expect(inserts('status:in_')).toEqual([
      'status:in_progress',
      'status:in_review',
    ]);
    expect(inserts('priority:')).toEqual([
      'priority:urgent',
      'priority:high',
      'priority:medium',
      'priority:low',
    ]);
  });

  it('offers me, then people, for the operators that name someone', () => {
    expect(inserts('assignee:')).toEqual([
      'assignee:me',
      'assignee:ana@example.com',
    ]);
  });

  it('offers the caller’s tags, inboxes and channels, quoted when spaced', () => {
    expect(inserts('tag:t')).toEqual(['tag:"Team offsite"', 'tag:Travel']);
    expect(inserts('launch tag:“Team off')).toEqual(['tag:"Team offsite"']);
    expect(inserts('inbox:te')).toEqual(['inbox:team@example.com']);
    expect(inserts('in:#q')).toEqual(['in:#"Q3 launch"']);
    expect(inserts('in:inbox')).toEqual([]);
  });

  it('writes a channel as it can be typed, quotes left out', () => {
    const values = { ...VALUES, channels: ['Launch "beta"'] };
    expect(
      searchOperatorCompletions('in:#launch', values).map((row) => row.insert)
    ).toEqual(['in:#"Launch beta"']);
  });

  it('writes a tag as it can be typed: quotes left out, an emoji alone', () => {
    const values = { ...VALUES, tags: ['Q3 "Plan"', '🔥'] };
    expect(
      searchOperatorCompletions('tag:q3', values).map((row) => row.insert)
    ).toEqual(['tag:"Q3 Plan"']);
    expect(
      searchOperatorCompletions('tag:', values).map((row) => row.insert)
    ).toEqual(['tag:"Q3 Plan"', 'tag:🔥']);
  });

  it('offers the filter a plain word stands for, and the person a name starts', () => {
    expect(inserts('budget tasks')).toEqual(['type:task']);
    expect(inserts('Docs')).toEqual(['type:doc']);
    expect(inserts('mail')).toEqual(['type:email']);
    expect(inserts('unread')).toEqual(['is:unread']);
    // Any word of the name, as Mail's search offers them.
    expect(inserts('ana')).toEqual([
      'from:ana@example.com',
      'assignee:ana@example.com',
    ]);
    expect(inserts('lim')).toEqual([
      'from:ana@example.com',
      'assignee:ana@example.com',
    ]);
    // An accent typed as a combining mark is the same name.
    const jose = {
      ...VALUES,
      people: [{ email: 'jose@example.com', name: 'José Ruiz' }],
    };
    for (const typed of ['José', 'Jose\u0301'])
      expect(
        searchOperatorCompletions(typed, jose).map((row) => row.insert)
      ).toEqual(['from:jose@example.com', 'assignee:jose@example.com']);
    // Too short to look up, finished, or inside a phrase: no rows.
    expect(inserts('an')).toEqual([]);
    expect(inserts('tasks ')).toEqual([]);
    expect(inserts('"tasks')).toEqual([]);
  });

  it('offers nothing once the operator is whole', () => {
    expect(inserts('type:task')).toEqual([]);
    expect(inserts('assignee:me')).toEqual([]);
  });
});
