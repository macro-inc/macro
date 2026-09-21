import { describe, expect, it } from 'vitest';
import {
  applyDatabaseView,
  type DatabaseCellValue,
  type DatabaseFilter,
  type DatabaseViewColumn,
  defaultDatabaseView,
  filterOperatorsFor,
  groupDatabaseRows,
  isBoardGroupColumn,
  isSavedDatabaseViewConfig,
  matchesDatabaseFilter,
  moveDatabaseViewColumn,
  orderDatabaseColumns,
  reconcileDatabaseView,
} from './database-view';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const amount = { ...name, id: 'amount', name: 'Budget', dataType: 'NUMBER' };
const status = {
  ...name,
  id: 'status',
  name: 'Status',
  dataType: 'SELECT_STRING',
  options: ['Backlog', 'In progress', 'Done'],
};
type Row = Record<string, DatabaseCellValue>;
const getValue = (row: Row, id: string) => row[id] ?? null;
const filter = (
  operator: DatabaseFilter['operator'],
  value = ''
): DatabaseFilter => ({ id: 'filter', columnId: 'amount', operator, value });

describe('database views', () => {
  it('combines case-insensitive search with all filter rules without mutating rows', () => {
    const rows: Row[] = [
      { name: "Wolf's launch", amount: 120, status: 'Done' },
      { name: "Wolf's launch", amount: 15, status: 'Backlog' },
      { name: 'Other', amount: 150, status: 'Done' },
    ];
    const result = applyDatabaseView(
      rows,
      [name, amount, status],
      {
        ...defaultDatabaseView(),
        search: "WOLF'S",
        filters: [filter('gte', '100')],
      },
      getValue
    );
    expect(result).toEqual([rows[0]]);
    expect(rows).toHaveLength(3);
  });

  it('distinguishes empty cells, zero, and unchecked checkboxes', () => {
    expect(matchesDatabaseFilter(null, amount, filter('is_empty'))).toBe(true);
    expect(matchesDatabaseFilter('', amount, filter('is_empty'))).toBe(true);
    expect(matchesDatabaseFilter(0, amount, filter('is_empty'))).toBe(false);
    expect(matchesDatabaseFilter(0, amount, filter('equals', '0'))).toBe(true);
    expect(matchesDatabaseFilter(null, amount, filter('equals', '0'))).toBe(
      false
    );
    expect(
      matchesDatabaseFilter(
        0,
        { ...amount, dataType: 'BOOLEAN' },
        filter('equals', '0')
      )
    ).toBe(true);
  });

  it('treats partial input as unfinished and preserves every row', () => {
    expect(matchesDatabaseFilter(null, amount, filter('gt', ''))).toBe(true);
    expect(matchesDatabaseFilter(null, amount, filter('gt', 'no number'))).toBe(
      true
    );
    expect(matchesDatabaseFilter(12, amount, filter('gt', 'no number'))).toBe(
      true
    );
  });

  it('compares numbers numerically and dates by the displayed calendar day', () => {
    expect(matchesDatabaseFilter(12, amount, filter('gt', '9'))).toBe(true);
    const date = { ...name, dataType: 'DATE' };
    expect(
      matchesDatabaseFilter(
        '2026-09-18T09:30:00Z',
        date,
        filter('equals', '2026-09-18')
      )
    ).toBe(true);
    expect(
      matchesDatabaseFilter(
        '2026-09-19T00:00:00Z',
        date,
        filter('gt', '2026-09-18')
      )
    ).toBe(true);
  });

  it('matches multi-select membership by whole labels, including quotes and commas', () => {
    const tags = { ...status, isMultiSelect: true };
    const values = JSON.stringify(['In progress', 'Design, "review"']);
    expect(
      matchesDatabaseFilter(values, tags, filter('equals', 'IN PROGRESS'))
    ).toBe(true);
    expect(
      matchesDatabaseFilter(values, tags, filter('equals', 'progress'))
    ).toBe(false);
    expect(
      matchesDatabaseFilter(values, tags, filter('equals', 'Design, "review"'))
    ).toBe(true);
    expect(
      matchesDatabaseFilter(values, tags, filter('not_equals', 'In progress'))
    ).toBe(false);
    expect(
      matchesDatabaseFilter(values, tags, filter('not_equals', 'Done'))
    ).toBe(true);
    expect(
      filterOperatorsFor(tags).find(({ value }) => value === 'equals')?.label
    ).toBe('contains');
    expect(
      filterOperatorsFor(tags).find(({ value }) => value === 'not_equals')
        ?.label
    ).toBe('does not contain');
  });

  it('treats empty multi-select lists as having no selected options', () => {
    const tags = { ...status, isMultiSelect: true };
    for (const value of [null, '', '[]', '[ ]']) {
      expect(matchesDatabaseFilter(value, tags, filter('is_empty'))).toBe(true);
      expect(matchesDatabaseFilter(value, tags, filter('equals', 'Done'))).toBe(
        false
      );
      expect(
        matchesDatabaseFilter(value, tags, filter('not_equals', 'Done'))
      ).toBe(true);
    }
    expect(matchesDatabaseFilter('[]', name, filter('is_empty'))).toBe(false);
    expect(matchesDatabaseFilter('[]', name, filter('equals', '[]'))).toBe(
      true
    );
  });

  it('handles numeric multi-values and keeps numeric select labels distinct', () => {
    expect(
      matchesDatabaseFilter(
        '[0,2,10]',
        { ...amount, isMultiSelect: true },
        filter('equals', '0')
      )
    ).toBe(true);
    expect(
      matchesDatabaseFilter(
        '[0,2,10]',
        { ...amount, isMultiSelect: true },
        filter('gt', '9')
      )
    ).toBe(true);
    const numericTags = {
      ...status,
      dataType: 'SELECT_NUMBER',
      isMultiSelect: true,
    };
    expect(
      matchesDatabaseFilter('["2","10"]', numericTags, filter('equals', '2'))
    ).toBe(true);
    expect(
      matchesDatabaseFilter('["2","10"]', numericTags, filter('equals', '02'))
    ).toBe(false);
  });

  it('searches decoded multi-value labels and combines membership filters', () => {
    const tags = { ...status, isMultiSelect: true };
    const rows: Row[] = [
      { status: JSON.stringify(['Design "review"', 'In progress']) },
      { status: JSON.stringify(['Design "review"', 'Done']) },
      { status: null },
    ];
    expect(
      applyDatabaseView(
        rows,
        [tags],
        {
          ...defaultDatabaseView(),
          search: '"review"',
          filters: [{ ...filter('not_equals', 'Done'), columnId: tags.id }],
        },
        getValue
      )
    ).toEqual([rows[0]]);
  });

  it('sorts numbers, keeps ties stable, and puts empty cells last in both directions', () => {
    const rows: Row[] = [
      { name: 'empty', amount: null },
      { name: 'a', amount: 10 },
      { name: 'b', amount: 2 },
      { name: 'c', amount: 10 },
    ];
    const view = {
      ...defaultDatabaseView(),
      sorts: [{ columnId: 'amount', direction: 'asc' as const }],
    };
    expect(
      applyDatabaseView(rows, [name, amount], view, getValue).map(
        (row) => row.name
      )
    ).toEqual(['b', 'a', 'c', 'empty']);
    expect(
      applyDatabaseView(
        rows,
        [name, amount],
        { ...view, sorts: [{ columnId: 'amount', direction: 'desc' }] },
        getValue
      ).map((row) => row.name)
    ).toEqual(['a', 'c', 'b', 'empty']);
    expect(rows[0].name).toBe('empty');
  });

  it('uses later sort columns only to break ties', () => {
    const rows: Row[] = [
      { name: 'B', amount: 2 },
      { name: 'A', amount: 2 },
      { name: 'C', amount: 1 },
    ];
    const result = applyDatabaseView(
      rows,
      [name, amount],
      {
        ...defaultDatabaseView(),
        sorts: [
          { columnId: 'amount', direction: 'asc' },
          { columnId: 'name', direction: 'asc' },
        ],
      },
      getValue
    );
    expect(result.map((row) => row.name)).toEqual(['C', 'A', 'B']);
  });

  it('keeps unused select options and legacy values in separate board groups', () => {
    const rows: Row[] = [
      { status: 'Done' },
      { status: 'Legacy' },
      { status: null },
    ];
    const groups = groupDatabaseRows(rows, status, getValue);
    expect(groups.map((group) => group.value)).toEqual([
      'Backlog',
      'In progress',
      'Done',
      'Legacy',
      null,
    ]);
    expect(groups.find((group) => group.value === 'Backlog')?.rows).toEqual([]);
    expect(groups.find((group) => group.value === null)?.rows).toEqual([
      rows[2],
    ]);
  });

  it('keeps numeric select labels as strings and boolean writes as integers', () => {
    const groups = groupDatabaseRows(
      [{ status: '10' }],
      { ...status, dataType: 'SELECT_NUMBER', options: [2, 10] },
      getValue
    );
    expect(groups.map((group) => group.value)).toEqual(['2', '10', null]);
    expect(groups[1].rows).toHaveLength(1);
    const checked = groupDatabaseRows(
      [{ status: 0 }, { status: 1 }, { status: null }],
      { ...status, dataType: 'BOOLEAN' },
      getValue
    );
    expect(checked.map((group) => group.value)).toEqual([0, 1, null]);
    expect(checked.map((group) => group.rows.length)).toEqual([1, 1, 1]);
  });

  it('does not collapse an empty lane into an option literally named empty', () => {
    const groups = groupDatabaseRows(
      [{ status: 'empty' }, { status: null }],
      { ...status, options: ['empty'] },
      getValue
    );
    expect(new Set(groups.map((group) => group.key)).size).toBe(2);
  });

  it('limits board grouping to scalar categorical fields', () => {
    expect(isBoardGroupColumn(status)).toBe(true);
    expect(isBoardGroupColumn({ ...status, writable: false })).toBe(true);
    expect(isBoardGroupColumn({ ...status, isMultiSelect: true })).toBe(false);
    expect(isBoardGroupColumn(name)).toBe(false);
  });

  it('rejects unrelated and malformed saved views', () => {
    const saved = {
      kind: 'database-view',
      version: 1,
      databaseId: 'db',
      tableId: 'table',
      view: defaultDatabaseView(),
    };
    expect(isSavedDatabaseViewConfig(saved)).toBe(true);
    expect(isSavedDatabaseViewConfig({ ...saved, kind: 'crm' })).toBe(false);
    expect(isSavedDatabaseViewConfig({ ...saved, version: 2 })).toBe(false);
    expect(
      isSavedDatabaseViewConfig({
        ...saved,
        view: { ...saved.view, filters: [{ operator: 'sql', value: 'DROP' }] },
      })
    ).toBe(false);
    expect(
      isSavedDatabaseViewConfig({
        ...saved,
        view: { ...saved.view, hiddenColumns: [2] },
      })
    ).toBe(false);
    expect(isSavedDatabaseViewConfig(null)).toBe(false);
    expect(
      isSavedDatabaseViewConfig({
        ...saved,
        view: { ...saved.view, columnOrder: ['name', 7] },
      })
    ).toBe(false);
  });

  it('drops missing columns from older views and chooses a valid board group', () => {
    const result = reconcileDatabaseView(
      {
        ...defaultDatabaseView(),
        layout: 'board',
        groupBy: 'deleted',
        hiddenColumns: ['deleted', 'name'],
        filters: [{ ...filter('equals', '1'), columnId: 'deleted' }],
        sorts: [{ columnId: 'deleted', direction: 'asc' }],
      },
      [name, status]
    );
    expect(result.groupBy).toBe('status');
    expect(result.hiddenColumns).toEqual(['name']);
    expect(result.filters).toEqual([]);
    expect(result.sorts).toEqual([]);
  });

  it('keeps legacy schema order and appends new columns after a saved custom order', () => {
    const columns = [name, amount, status];
    expect(orderDatabaseColumns(columns)).toEqual(columns);
    expect(
      orderDatabaseColumns(columns, ['status', 'deleted', 'status', 'name'])
    ).toEqual([status, name, amount]);
    expect(columns).toEqual([name, amount, status]);
  });

  it('moves across hidden columns without changing their position or other settings', () => {
    const view = {
      ...defaultDatabaseView(),
      hiddenColumns: ['amount'],
      search: 'launch',
    };
    const moved = moveDatabaseViewColumn(
      view,
      [name, amount, status],
      'status',
      'left'
    );
    expect(moved.columnOrder).toEqual(['status', 'amount', 'name']);
    expect(moved.hiddenColumns).toEqual(['amount']);
    expect(moved.search).toBe('launch');
    expect(view.columnOrder).toBeUndefined();
    const restored = moveDatabaseViewColumn(
      moved,
      [name, amount, status],
      'status',
      'right'
    );
    expect(restored.columnOrder).toBeUndefined();
  });

  it('does not move an edge, hidden, or missing column', () => {
    const view = { ...defaultDatabaseView(), hiddenColumns: ['amount'] };
    for (const [id, direction] of [
      ['name', 'left'],
      ['status', 'right'],
      ['amount', 'left'],
      ['missing', 'right'],
    ] as const) {
      expect(
        moveDatabaseViewColumn(view, [name, amount, status], id, direction)
      ).toBe(view);
    }
  });

  it('reconciles deleted and duplicate order ids without hiding newly added columns', () => {
    const view = reconcileDatabaseView(
      {
        ...defaultDatabaseView(),
        columnOrder: ['deleted', 'status', 'status', 'name'],
        hiddenColumns: ['deleted', 'name'],
      },
      [name, amount, status]
    );
    expect(view.columnOrder).toEqual(['status', 'name', 'amount']);
    expect(view.hiddenColumns).toEqual(['name']);
    expect(
      orderDatabaseColumns([name, amount, status], view.columnOrder).filter(
        (column) => !view.hiddenColumns.includes(column.id)
      )
    ).toEqual([status, amount]);
    expect(
      reconcileDatabaseView(view, [name, amount]).columnOrder
    ).toBeUndefined();
  });
});
