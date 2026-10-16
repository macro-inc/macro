import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import {
  addCondition,
  addGroup,
  completeFilter,
  defaultCondition,
  filterOperators,
  removeNode,
  searchFilter,
  setConjunction,
  updateCondition,
  withOperator,
  withSort,
  withSortMoved,
} from './view-query';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const rsvp: DatabaseViewColumn = {
  id: 'rsvp',
  name: 'RSVP',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  options: [
    { id: 'yes', label: 'Yes', color: '#46A758' },
    { id: 'no', label: 'No', color: null },
    { id: 'maybe', label: 'Maybe later', color: null },
  ],
  writable: true,
};
const labels: DatabaseViewColumn = {
  id: 'labels',
  name: 'Labels',
  dataType: 'SELECT_STRING',
  isMultiSelect: true,
  options: [{ id: 'vip', label: 'VIP', color: null }],
  writable: true,
};
const guests: DatabaseViewColumn = {
  id: 'guests',
  name: 'Guests',
  dataType: 'NUMBER',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const invited: DatabaseViewColumn = {
  id: 'invited',
  name: 'Invited',
  dataType: 'BOOLEAN',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const partner: DatabaseViewColumn = {
  id: 'partner',
  name: 'Partner',
  dataType: 'ENTITY',
  isMultiSelect: true,
  options: [],
  writable: true,
  relation: { databaseId: 'database', tableId: 'people' },
};

describe('filter conditions', () => {
  it('starts each kind of column with the test that fits it', () => {
    expect(defaultCondition(name)).toEqual({
      kind: 'condition',
      column: 'name',
      test: { kind: 'text', operator: 'contains', value: '' },
    });
    expect(defaultCondition(rsvp)).toEqual({
      kind: 'condition',
      column: 'rsvp',
      test: { kind: 'options', operator: 'isAnyOf', options: [] },
    });
    expect(defaultCondition(labels)).toEqual({
      kind: 'condition',
      column: 'labels',
      test: { kind: 'options', operator: 'hasAny', options: [] },
    });
    expect(defaultCondition(guests)).toEqual({
      kind: 'condition',
      column: 'guests',
      test: { kind: 'number', operator: 'is', value: Number.NaN },
    });
    expect(defaultCondition(invited)).toEqual({
      kind: 'condition',
      column: 'invited',
      test: { kind: 'checkbox', checked: true },
    });
    expect(defaultCondition(partner)).toEqual({
      kind: 'condition',
      column: 'partner',
      test: { kind: 'presence', operator: 'isEmpty' },
    });
  });

  it('offers set tests by how many options a cell holds, and emptiness for any column', () => {
    expect(filterOperators(rsvp).map((choice) => choice.label)).toEqual([
      'is any of',
      'is none of',
      'is empty',
      'is not empty',
    ]);
    expect(filterOperators(labels).map((choice) => choice.label)).toEqual([
      'has any of',
      'has all of',
      'has none of',
      'is empty',
      'is not empty',
    ]);
    expect(filterOperators(partner).map((choice) => choice.label)).toEqual([
      'is empty',
      'is not empty',
    ]);
    expect(filterOperators(invited).map((choice) => choice.label)).toEqual([
      'is checked',
      'is unchecked',
    ]);
  });

  it('keeps the value when the new operator tests the same kind, and drops it otherwise', () => {
    expect(
      withOperator(
        { kind: 'text', operator: 'contains', value: 'Sam' },
        { kind: 'text', operator: 'startsWith' }
      )
    ).toEqual({ kind: 'text', operator: 'startsWith', value: 'Sam' });
    expect(
      withOperator(
        { kind: 'options', operator: 'isAnyOf', options: ['yes'] },
        { kind: 'options', operator: 'isNoneOf' }
      )
    ).toEqual({ kind: 'options', operator: 'isNoneOf', options: ['yes'] });
    expect(
      withOperator(
        { kind: 'text', operator: 'contains', value: 'Sam' },
        { kind: 'presence', operator: 'isEmpty' }
      )
    ).toEqual({ kind: 'presence', operator: 'isEmpty' });
    expect(
      withOperator(
        { kind: 'presence', operator: 'isEmpty' },
        { kind: 'text', operator: 'is' }
      )
    ).toEqual({ kind: 'text', operator: 'is', value: '' });
  });
});

describe('filter groups', () => {
  it('adds conditions and nested groups where the path points', () => {
    const root = addCondition({ conjunction: 'and', conditions: [] }, [], name);
    expect(root).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: '' },
        },
      ],
    });
    const nested = addGroup(root, [], rsvp);
    expect(nested).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: '' },
        },
        {
          kind: 'group',
          conjunction: 'or',
          conditions: [
            {
              kind: 'condition',
              column: 'rsvp',
              test: { kind: 'options', operator: 'isAnyOf', options: [] },
            },
          ],
        },
      ],
    });
    expect(addCondition(nested, [1], guests)).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: '' },
        },
        {
          kind: 'group',
          conjunction: 'or',
          conditions: [
            {
              kind: 'condition',
              column: 'rsvp',
              test: { kind: 'options', operator: 'isAnyOf', options: [] },
            },
            {
              kind: 'condition',
              column: 'guests',
              test: { kind: 'number', operator: 'is', value: Number.NaN },
            },
          ],
        },
      ],
    });
  });

  it('changes one condition or one group conjunction by its path', () => {
    const root = {
      conjunction: 'and' as const,
      conditions: [
        {
          kind: 'group' as const,
          conjunction: 'or' as const,
          conditions: [
            {
              kind: 'condition' as const,
              column: 'name',
              test: {
                kind: 'text' as const,
                operator: 'is' as const,
                value: '',
              },
            },
          ],
        },
      ],
    };
    expect(
      updateCondition(root, [0, 0], (condition) => ({
        ...condition,
        test: { kind: 'text', operator: 'is', value: 'Sam' },
      }))
    ).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'group',
          conjunction: 'or',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'is', value: 'Sam' },
            },
          ],
        },
      ],
    });
    expect(setConjunction(root, [0], 'and')).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'group',
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'is', value: '' },
            },
          ],
        },
      ],
    });
    expect(setConjunction(root, [], 'or')).toEqual({
      ...root,
      conjunction: 'or',
    });
  });

  it('removes a condition, and the group it leaves empty', () => {
    const root = {
      conjunction: 'and' as const,
      conditions: [
        {
          kind: 'condition' as const,
          column: 'invited',
          test: { kind: 'checkbox' as const, checked: true },
        },
        {
          kind: 'group' as const,
          conjunction: 'or' as const,
          conditions: [
            {
              kind: 'condition' as const,
              column: 'name',
              test: {
                kind: 'text' as const,
                operator: 'is' as const,
                value: 'Sam',
              },
            },
          ],
        },
      ],
    };
    expect(removeNode(root, [1, 0])).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'invited',
          test: { kind: 'checkbox', checked: true },
        },
      ],
    });
    expect(removeNode(root, [0])).toEqual({
      conjunction: 'and',
      conditions: [root.conditions[1]],
    });
  });

  it('leaves out unfinished conditions and the groups they empty when the view saves', () => {
    expect(
      completeFilter({
        conjunction: 'or',
        conditions: [
          {
            kind: 'condition',
            column: 'name',
            test: { kind: 'text', operator: 'contains', value: '  ' },
          },
          {
            kind: 'condition',
            column: 'guests',
            test: { kind: 'number', operator: 'is', value: Number.NaN },
          },
          {
            kind: 'group',
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: 'rsvp',
                test: { kind: 'options', operator: 'isAnyOf', options: [] },
              },
            ],
          },
          {
            kind: 'group',
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: 'rsvp',
                test: {
                  kind: 'options',
                  operator: 'isAnyOf',
                  options: ['yes'],
                },
              },
              {
                kind: 'condition',
                column: 'name',
                test: { kind: 'presence', operator: 'isEmpty' },
              },
            ],
          },
        ],
      })
    ).toEqual({
      conjunction: 'or',
      conditions: [
        {
          kind: 'group',
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'rsvp',
              test: { kind: 'options', operator: 'isAnyOf', options: ['yes'] },
            },
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'presence', operator: 'isEmpty' },
            },
          ],
        },
      ],
    });
    expect(
      completeFilter({
        conjunction: 'and',
        conditions: [
          {
            kind: 'condition',
            column: 'name',
            test: { kind: 'text', operator: 'is', value: '' },
          },
        ],
      })
    ).toBeNull();
  });
});

describe('search', () => {
  it('matches any text cell holding the term, or any option whose label does', () => {
    expect(searchFilter(' may ', [name, rsvp, labels, guests])).toEqual({
      kind: 'matching',
      filter: {
        kind: 'group',
        conjunction: 'or',
        conditions: [
          {
            kind: 'condition',
            column: 'name',
            test: { kind: 'text', operator: 'contains', value: 'may' },
          },
          {
            kind: 'condition',
            column: 'rsvp',
            test: { kind: 'options', operator: 'isAnyOf', options: ['maybe'] },
          },
        ],
      },
    });
    expect(searchFilter('vip', [labels])).toEqual({
      kind: 'matching',
      filter: {
        kind: 'group',
        conjunction: 'or',
        conditions: [
          {
            kind: 'condition',
            column: 'labels',
            test: { kind: 'options', operator: 'hasAny', options: ['vip'] },
          },
        ],
      },
    });
  });

  it('searches nothing for a blank term, and finds nothing when no column can hold it', () => {
    expect(searchFilter('   ', [name])).toBeUndefined();
    expect(searchFilter('zzz', [rsvp, guests])).toEqual({ kind: 'nothing' });
    expect(searchFilter('zzz', [])).toEqual({ kind: 'nothing' });
  });
});

describe('sorts', () => {
  it('puts a newly sorted column first and drops a removed one', () => {
    const sort = [
      { column: 'name', direction: 'ascending' as const },
      { column: 'guests', direction: 'descending' as const },
    ];
    expect(withSort(sort, 'guests', 'ascending')).toEqual([
      { column: 'guests', direction: 'ascending' },
      { column: 'name', direction: 'ascending' },
    ]);
    expect(withSort(sort, 'name', null)).toEqual([
      { column: 'guests', direction: 'descending' },
    ]);
  });
});

describe('moving a sort key', () => {
  it('reorders the sort levels, keeping each key’s direction', () => {
    expect(
      withSortMoved(
        [
          { column: 'name', direction: 'ascending' },
          { column: 'guests', direction: 'descending' },
          { column: 'date', direction: 'ascending' },
        ],
        'date',
        'name',
        'before'
      )
    ).toEqual([
      { column: 'date', direction: 'ascending' },
      { column: 'name', direction: 'ascending' },
      { column: 'guests', direction: 'descending' },
    ]);
  });

  it('moves nothing beside a column the sort lacks', () => {
    expect(
      withSortMoved(
        [{ column: 'name', direction: 'ascending' }],
        'name',
        'guests',
        'after'
      )
    ).toBeUndefined();
  });
});
