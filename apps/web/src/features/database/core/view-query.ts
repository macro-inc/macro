/**
 * Editing a view's typed filter tree and sort keys. A node is addressed by its
 * path of indexes from the root group; `[]` is the root.
 */

import { match } from 'ts-pattern';
import type {
  Conjunction,
  DateOperator,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterTest,
  NumberOperator,
  PresenceOperator,
  SetOperator,
  SortDirection,
  SortKey,
  TextOperator,
  ValueKind,
} from '../../../lib/core/database-sql/generated/types';
import type { DatabaseViewColumn } from './database-view';
import { moveBeside } from './move-beside';

export type FilterPath = readonly number[];

type Condition = Extract<FilterNode, { kind: 'condition' }>;

/** A test without its value: what an operator menu chooses between. */
type FilterOperator =
  | { kind: 'presence'; operator: PresenceOperator }
  | { kind: 'text'; operator: TextOperator }
  | { kind: 'number'; operator: NumberOperator }
  | { kind: 'date'; operator: DateOperator }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'options'; operator: SetOperator };

type FilterOperatorChoice = {
  /** Stable across renders, for a select control. */
  id: string;
  label: string;
  operator: FilterOperator;
};

/** What a column holds, as filter tests tell values apart. */
function columnValueKind(column: DatabaseViewColumn): ValueKind {
  if (column.relation) return 'entities';
  return match(column.dataType)
    .returnType<ValueKind>()
    .with('STRING', 'LINK', () => 'text')
    .with('NUMBER', () => 'number')
    .with('DATE', () => 'date')
    .with('BOOLEAN', () => 'checkbox')
    .with('SELECT_STRING', 'SELECT_NUMBER', 'TAG', () => 'options')
    .with('ENTITY', () => 'entities')
    .exhaustive();
}

function operatorId(test: FilterOperator | FilterTest): string {
  return 'checked' in test
    ? `checkbox:${test.checked}`
    : `${test.kind}:${test.operator}`;
}

function choice(label: string, operator: FilterOperator): FilterOperatorChoice {
  return { id: operatorId(operator), label, operator };
}

const PRESENCE = [
  choice('is empty', { kind: 'presence', operator: 'isEmpty' }),
  choice('is not empty', { kind: 'presence', operator: 'isNotEmpty' }),
];

/**
 * The tests a column offers. References only test whether they are empty:
 * their values are ids, which no menu here picks.
 */
export function filterOperators(
  column: DatabaseViewColumn
): FilterOperatorChoice[] {
  return match(columnValueKind(column))
    .returnType<FilterOperatorChoice[]>()
    .with('text', () => [
      choice('contains', { kind: 'text', operator: 'contains' }),
      choice('does not contain', { kind: 'text', operator: 'doesNotContain' }),
      choice('is', { kind: 'text', operator: 'is' }),
      choice('is not', { kind: 'text', operator: 'isNot' }),
      choice('starts with', { kind: 'text', operator: 'startsWith' }),
      choice('ends with', { kind: 'text', operator: 'endsWith' }),
      ...PRESENCE,
    ])
    .with('number', () => [
      choice('is', { kind: 'number', operator: 'is' }),
      choice('is not', { kind: 'number', operator: 'isNot' }),
      choice('is greater than', { kind: 'number', operator: 'greaterThan' }),
      choice('is at least', { kind: 'number', operator: 'greaterThanOrEqual' }),
      choice('is less than', { kind: 'number', operator: 'lessThan' }),
      choice('is at most', { kind: 'number', operator: 'lessThanOrEqual' }),
      ...PRESENCE,
    ])
    .with('date', () => [
      choice('is before', { kind: 'date', operator: 'before' }),
      choice('is after', { kind: 'date', operator: 'after' }),
      choice('is on or before', { kind: 'date', operator: 'onOrBefore' }),
      choice('is on or after', { kind: 'date', operator: 'onOrAfter' }),
      ...PRESENCE,
    ])
    .with('checkbox', () => [
      choice('is checked', { kind: 'checkbox', checked: true }),
      choice('is unchecked', { kind: 'checkbox', checked: false }),
    ])
    .with('options', () =>
      column.isMultiSelect
        ? [
            choice('has any of', { kind: 'options', operator: 'hasAny' }),
            choice('has all of', { kind: 'options', operator: 'hasAll' }),
            choice('has none of', { kind: 'options', operator: 'hasNone' }),
            ...PRESENCE,
          ]
        : [
            choice('is any of', { kind: 'options', operator: 'isAnyOf' }),
            choice('is none of', { kind: 'options', operator: 'isNoneOf' }),
            ...PRESENCE,
          ]
    )
    .with('entities', () => PRESENCE)
    .exhaustive();
}

/** The choice a test was made from, to show in its operator menu. */
export function operatorChoiceOf(
  column: DatabaseViewColumn,
  test: FilterTest
): FilterOperatorChoice | undefined {
  const id = operatorId(test);
  return filterOperators(column).find((option) => option.id === id);
}

/**
 * A test for `operator`, keeping the value `previous` held when it tests the
 * same kind of value. A number not yet entered is `NaN`, a date `''`.
 */
export function withOperator(
  previous: FilterTest,
  operator: FilterOperator
): FilterTest {
  return match(operator)
    .returnType<FilterTest>()
    .with({ kind: 'presence' }, (next) => next)
    .with({ kind: 'checkbox' }, (next) => next)
    .with({ kind: 'text' }, (next) => ({
      ...next,
      value: previous.kind === 'text' ? previous.value : '',
    }))
    .with({ kind: 'number' }, (next) => ({
      ...next,
      value: previous.kind === 'number' ? previous.value : Number.NaN,
    }))
    .with({ kind: 'date' }, (next) => ({
      ...next,
      value: previous.kind === 'date' ? previous.value : '',
    }))
    .with({ kind: 'options' }, (next) => ({
      ...next,
      options: previous.kind === 'options' ? previous.options : [],
    }))
    .exhaustive();
}

/** A new condition on `column`, with the first test the column offers. */
export function defaultCondition(column: DatabaseViewColumn): Condition {
  const [first] = filterOperators(column);
  return {
    kind: 'condition',
    column: column.id,
    test: withOperator(
      { kind: 'presence', operator: 'isEmpty' },
      first.operator
    ),
  };
}

/** Whether a test has everything it compares against. */
function isComplete(test: FilterTest): boolean {
  return match(test)
    .with({ kind: 'presence' }, { kind: 'checkbox' }, () => true)
    .with({ kind: 'text' }, ({ value }) => value.trim() !== '')
    .with({ kind: 'number' }, ({ value }) => Number.isFinite(value))
    .with({ kind: 'date' }, ({ value }) => value !== '')
    .with({ kind: 'options' }, ({ options }) => options.length > 0)
    .with({ kind: 'entities' }, ({ entities }) => entities.length > 0)
    .exhaustive();
}

function completeNode(node: FilterNode): FilterNode | undefined {
  if (node.kind === 'condition')
    return isComplete(node.test) ? node : undefined;
  const group = completeFilter(node);
  return group ? { kind: 'group', ...group } : undefined;
}

/**
 * The filter a view saves: the conditions still being filled in left out,
 * and the groups that leaves empty; `null` when nothing is left.
 */
export function completeFilter(group: FilterGroup): FilterGroup | null {
  const conditions = group.conditions.flatMap((node) => {
    const complete = completeNode(node);
    return complete ? [complete] : [];
  });
  return conditions.length
    ? { conjunction: group.conjunction, conditions }
    : null;
}

/** The group at `path` changed by `change`; nodes off the path stay as they are. */
function changeGroup(
  group: FilterGroup,
  path: FilterPath,
  change: (group: FilterGroup) => FilterGroup
): FilterGroup {
  const [index, ...rest] = path;
  if (index === undefined) return change(group);
  return {
    ...group,
    conditions: group.conditions.map((node, position) =>
      position === index && node.kind === 'group'
        ? { kind: 'group', ...changeGroup(node, rest, change) }
        : node
    ),
  };
}

export function addCondition(
  group: FilterGroup,
  path: FilterPath,
  column: DatabaseViewColumn
): FilterGroup {
  return changeGroup(group, path, (target) => ({
    ...target,
    conditions: [...target.conditions, defaultCondition(column)],
  }));
}

/** A nested group joined the other way from its parent, starting with one condition. */
export function addGroup(
  group: FilterGroup,
  path: FilterPath,
  column: DatabaseViewColumn
): FilterGroup {
  return changeGroup(group, path, (target) => ({
    ...target,
    conditions: [
      ...target.conditions,
      {
        kind: 'group',
        conjunction: target.conjunction === 'and' ? 'or' : 'and',
        conditions: [defaultCondition(column)],
      },
    ],
  }));
}

export function setConjunction(
  group: FilterGroup,
  path: FilterPath,
  conjunction: Conjunction
): FilterGroup {
  return changeGroup(group, path, (target) => ({ ...target, conjunction }));
}

export function updateCondition(
  group: FilterGroup,
  path: FilterPath,
  change: (condition: FilterCondition) => FilterCondition
): FilterGroup {
  const parent = path.slice(0, -1);
  const index = path[path.length - 1];
  return changeGroup(group, parent, (target) => ({
    ...target,
    conditions: target.conditions.map((node, position) =>
      position === index && node.kind === 'condition'
        ? { kind: 'condition', ...change(node) }
        : node
    ),
  }));
}

/** Without the node at `path`; a nested group it leaves empty goes too. */
export function removeNode(group: FilterGroup, path: FilterPath): FilterGroup {
  const [index, ...rest] = path;
  return {
    ...group,
    conditions: group.conditions.flatMap((node, position) => {
      if (position !== index) return [node];
      if (!rest.length || node.kind === 'condition') return [];
      const remaining = removeNode(node, rest);
      return remaining.conditions.length
        ? [{ kind: 'group' as const, ...remaining }]
        : [];
    }),
  };
}

/** What a search keeps: the rows a filter matches, or none at all. */
export type DatabaseSearch =
  | { kind: 'matching'; filter: FilterNode }
  /** No column can hold the term. */
  | { kind: 'nothing' };

/**
 * Rows holding `term`: a text cell containing it, or an option whose label
 * does. A blank term searches nothing and keeps every row.
 */
export function searchFilter(
  term: string,
  columns: readonly DatabaseViewColumn[]
): DatabaseSearch | undefined {
  const text = term.trim();
  if (!text) return undefined;
  const lower = text.toLocaleLowerCase();
  const conditions = columns.flatMap((column): FilterNode[] =>
    match(columnValueKind(column))
      .returnType<FilterNode[]>()
      .with('text', () => [
        {
          kind: 'condition',
          column: column.id,
          test: { kind: 'text', operator: 'contains', value: text },
        },
      ])
      .with('options', () => {
        const options = column.options
          .filter((option) => option.label.toLocaleLowerCase().includes(lower))
          .map((option) => option.id);
        return options.length
          ? [
              {
                kind: 'condition',
                column: column.id,
                test: {
                  kind: 'options',
                  operator: column.isMultiSelect ? 'hasAny' : 'isAnyOf',
                  options,
                },
              },
            ]
          : [];
      })
      .with('number', 'date', 'checkbox', 'entities', () => [])
      .exhaustive()
  );
  return conditions.length
    ? {
        kind: 'matching',
        filter: { kind: 'group', conjunction: 'or', conditions },
      }
    : { kind: 'nothing' };
}

/** Sorted by `column` first, or no longer by it when `direction` is null. */
export function withSort(
  sort: readonly SortKey[],
  column: string,
  direction: SortDirection | null
): SortKey[] {
  const others = sort.filter((key) => key.column !== column);
  return direction ? [{ column, direction }, ...others] : others;
}

/** The sort with `column`'s key moved just before or after `target`'s, changing which sorts first. */
export function withSortMoved(
  sort: readonly SortKey[],
  column: string,
  target: string,
  edge: 'before' | 'after'
): SortKey[] | undefined {
  const keys = new Map(sort.map((key) => [key.column, key]));
  return moveBeside(
    sort.map((key) => key.column),
    column,
    target,
    edge
  )?.flatMap((id) => {
    const key = keys.get(id);
    return key ? [key] : [];
  });
}
