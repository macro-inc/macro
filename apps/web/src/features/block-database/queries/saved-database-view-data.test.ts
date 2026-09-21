import { describe, expect, it } from 'vitest';
import {
  defaultDatabaseView,
  orderDatabaseColumns,
  reconcileDatabaseView,
} from '../core/database-view';
import { selectSavedDatabaseViews } from './saved-database-view-data';

describe('saved database view scope', () => {
  it('only returns validated views for the current database and table', () => {
    const view = defaultDatabaseView();
    const config = {
      kind: 'database-view',
      version: 1,
      databaseId: 'db',
      tableId: 'table',
      view,
    };
    const entries = [
      { id: 'matching', name: 'My board', config },
      {
        id: 'other-db',
        name: 'Different database',
        config: { ...config, databaseId: 'other' },
      },
      {
        id: 'other-table',
        name: 'Different table',
        config: { ...config, tableId: 'other' },
      },
      { id: 'crm', name: 'Customer view', config: { kind: 'crm' } },
      {
        id: 'malformed',
        name: 'Malformed view',
        config: { ...config, view: null },
      },
    ];
    expect(selectSavedDatabaseViews(entries, 'db', 'table')).toEqual([
      { id: 'matching', name: 'My board', view },
    ]);
    expect(selectSavedDatabaseViews(entries, 'db', undefined)).toEqual([]);
  });

  it('restores ordered and hidden columns from saved JSON while admitting new schema columns', () => {
    const config: unknown = JSON.parse(
      JSON.stringify({
        kind: 'database-view',
        version: 1,
        databaseId: 'db',
        tableId: 'table',
        view: {
          ...defaultDatabaseView(),
          columnOrder: ['status', 'name'],
          hiddenColumns: ['status'],
        },
      })
    );
    const [saved] = selectSavedDatabaseViews(
      [{ id: 'saved', name: 'My layout', config }],
      'db',
      'table'
    );
    expect(saved.view.columnOrder).toEqual(['status', 'name']);
    const columns = ['name', 'status', 'new-date'].map((id) => ({
      id,
      name: id,
      dataType: 'STRING',
      isMultiSelect: false,
      options: [],
      writable: true,
    }));
    const restored = reconcileDatabaseView(saved.view, columns);
    const ordered = orderDatabaseColumns(columns, restored.columnOrder);
    expect(ordered.map((column) => column.id)).toEqual([
      'status',
      'name',
      'new-date',
    ]);
    expect(
      ordered
        .filter((column) => !restored.hiddenColumns.includes(column.id))
        .map((column) => column.id)
    ).toEqual(['name', 'new-date']);
  });
});
