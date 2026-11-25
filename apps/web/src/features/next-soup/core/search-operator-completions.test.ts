import { describe, expect, it } from 'vitest';
import {
  completeSearchOperator,
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
    expect(inserts('inbox:te')).toEqual(['inbox:team@example.com']);
    expect(inserts('in:#q')).toEqual(['in:#"Q3 launch"']);
    expect(inserts('in:inbox')).toEqual([]);
  });

  it('offers nothing once the operator is whole', () => {
    expect(inserts('type:task')).toEqual([]);
  });
});

describe('completeSearchOperator', () => {
  it('writes the row in place of the token being typed', () => {
    const [row] = searchOperatorCompletions('launch type:ta', VALUES);
    expect(row && completeSearchOperator('launch type:ta', row)).toBe(
      'launch type:task '
    );
  });

  it('leaves the caret after a name, for its value', () => {
    const [row] = searchOperatorCompletions('launch ty', VALUES);
    expect(row && completeSearchOperator('launch ty', row)).toBe(
      'launch type:'
    );
  });
});
