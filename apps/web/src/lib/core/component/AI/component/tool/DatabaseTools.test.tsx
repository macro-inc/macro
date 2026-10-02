import { showDatabaseSql } from '@core/constant/featureFlags';
import type {
  NamedTool,
  ToolName,
} from '@service-cognition/generated/tools/tool';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseToolHandlers } from './DatabaseTools';

vi.mock('@app/features/database-query/answer-display', () => ({
  AppAnswerDisplay: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/database-query/views/tool-query-results', () => ({
  ToolQueryResults: (props: { sql: string }) => (
    <output aria-label="Query results" data-sql={props.sql} />
  ),
}));
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => null }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
}));
const invalidateDatabase = vi.hoisted(() => vi.fn());
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
    StaticMarkdown: (props: { markdown: string }) => (
      <output aria-label="Saved answer">{props.markdown}</output>
    ),
  })
);
vi.mock('@queries/storage/databases', () => ({
  invalidateDatabase,
  useDatabaseDetailQuery: (databaseId: () => string | undefined) => ({
    get isSuccess() {
      return !!databaseId();
    },
    data: {
      database: { id: databaseId(), name: 'Party Planner' },
      tables: [
        { table: { id: guestsTableId, name: 'Guests' } },
        { table: { id: invitesTableId, name: 'Invites' } },
      ],
    },
  }),
}));
afterEach(() => {
  cleanup();
  showDatabaseSql.enabled = false;
});

const databaseId = '01992d2f-8444-7000-8000-000000000001';
const tableId = '01992d2f-8444-7000-8000-000000000002';
const columnId = '01992d2f-8444-7000-8000-000000000003';
const otherColumnId = '01992d2f-8444-7000-8000-000000000005';
const guestsTableId = '01992d2f-8444-7000-8000-000000000006';
const invitesTableId = '01992d2f-8444-7000-8000-000000000007';

const database: NamedTool<'DescribeDatabase', 'response'>['data'] = {
  id: databaseId,
  name: 'Launch',
  grant: 'edit',
  tables: [
    {
      views: [],
      id: tableId,
      name: 'Tickets',
      sqlName: 'Tickets',
      version: 3,
      writable: true,
      columns: [
        {
          id: columnId,
          name: 'Status',
          sqlName: 'Status',
          dataType: 'select',
          isMultiSelect: false,
          writable: true,
          safeTypes: ['text', 'select[]'],
          checkedTypes: ['number'],
        },
      ],
    },
  ],
};

function renderTool<Name extends ToolName>(
  handler: { render: Component<never> },
  name: Name,
  call: NamedTool<Name, 'call'>['data'],
  response?: NamedTool<Name, 'response'>['data']
) {
  return render(() => (
    <Dynamic
      component={handler.render as Component<Record<string, unknown>>}
      tool={{ id: 'tool-1', name, data: call }}
      response={
        response === undefined
          ? undefined
          : { id: 'tool-1', name, data: response }
      }
      chat_id="chat-1"
      message_id="message-1"
      part_index={0}
      isComplete={response !== undefined}
      renderContext={{
        isStreaming: false,
        grouped: false,
        followedBy: () => false,
      }}
    />
  ));
}

function line(rendered: ReturnType<typeof render>) {
  return rendered.container.textContent?.replace(/\s+/g, ' ').trim();
}

describe('database schema tool activity', () => {
  it('renders DescribeDatabase with its database and table count', () => {
    renderTool(
      databaseToolHandlers.DescribeDatabase,
      'DescribeDatabase',
      { databaseId },
      database
    );
    expect(screen.getByText('Read database').textContent).toBe(
      'Read database Launch'
    );
    expect(screen.getByText('1 table')).toBeTruthy();
  });

  it('renders RenameDatabase with the name the server kept', () => {
    const rendered = renderTool(
      databaseToolHandlers.RenameDatabase,
      'RenameDatabase',
      { databaseId, name: 'launch ' },
      { databaseId, name: 'Launch', database }
    );
    expect(line(rendered)).toBe('Rename database to Launch');
  });

  it('renders DeleteTable with the database it left', () => {
    const rendered = renderTool(
      databaseToolHandlers.DeleteTable,
      'DeleteTable',
      { databaseId, tableId },
      { databaseId, tableId, database }
    );
    expect(line(rendered)).toBe('Delete table from Launch');
  });

  it('renders DeleteDatabaseView with the name of the view it deleted', () => {
    const rendered = renderTool(
      databaseToolHandlers.DeleteDatabaseView,
      'DeleteDatabaseView',
      { databaseId, viewId: 'view-1' },
      { databaseId, tableId, viewId: 'view-1', name: 'Stages' }
    );
    expect(line(rendered)).toBe('Deleted view Stages');
  });

  it('renders RenameColumn with its table', () => {
    const rendered = renderTool(
      databaseToolHandlers.RenameColumn,
      'RenameColumn',
      { databaseId, tableId, columnId, name: 'Status' },
      { databaseId, tableId, columnId, name: 'Status', database }
    );
    expect(line(rendered)).toBe('Rename column to Status in Tickets');
  });

  it('renders ChangeColumnType with the column name from the schema', () => {
    const rendered = renderTool(
      databaseToolHandlers.ChangeColumnType,
      'ChangeColumnType',
      {
        databaseId,
        tableId,
        columnId,
        dataType: 'select',
        options: ['Open', 'Done'],
      },
      {
        databaseId,
        tableId,
        columnId,
        database,
      }
    );
    expect(line(rendered)).toBe('Change Status to select · Open, Done');
  });

  it('renders ChangeColumnType before the schema arrives', () => {
    const rendered = renderTool(
      databaseToolHandlers.ChangeColumnType,
      'ChangeColumnType',
      {
        databaseId,
        tableId,
        columnId,
        dataType: 'number',
      }
    );
    expect(line(rendered)).toBe('Change column type to number');
  });

  it('renders DeleteColumn with the table it left', () => {
    const rendered = renderTool(
      databaseToolHandlers.DeleteColumn,
      'DeleteColumn',
      { databaseId, tableId, columnId: otherColumnId },
      { databaseId, tableId, columnId: otherColumnId, database }
    );
    expect(line(rendered)).toBe('Delete column from Tickets');
  });

  it('renders ReorderColumns with its table', () => {
    const rendered = renderTool(
      databaseToolHandlers.ReorderColumns,
      'ReorderColumns',
      { databaseId, tableId, columnIds: [columnId, otherColumnId] },
      { databaseId, tableId, database }
    );
    expect(line(rendered)).toBe('Reorder 2 columns in Tickets');
  });

  it('renders ReorderTables with its database', () => {
    const rendered = renderTool(
      databaseToolHandlers.ReorderTables,
      'ReorderTables',
      { databaseId, tableIds: [tableId, otherColumnId] },
      { databaseId, tableIds: [tableId, otherColumnId], database }
    );
    expect(line(rendered)).toBe('Reorder 2 tables in Launch');
  });

  it('renders a delete without a refreshed schema', () => {
    const rendered = renderTool(
      databaseToolHandlers.DeleteColumn,
      'DeleteColumn',
      { databaseId, tableId, columnId },
      {
        databaseId,
        tableId,
        columnId,
        database: null,
        warning: 'Call DescribeDatabase before continuing.',
      }
    );
    expect(line(rendered)).toBe('Delete column');
  });
});

describe('SaveDatabaseQuery', () => {
  it('renders the saved block from the tool output', () => {
    const markdown =
      '<m-db-query>{"queryId":"01992d2f-8444-7000-8000-000000000004","title":"Open tickets","prompt":"How many open tickets?","displayMode":"scalar"}</m-db-query>';
    renderTool(
      databaseToolHandlers.SaveDatabaseQuery,
      'SaveDatabaseQuery',
      {
        databaseId,
        sql: 'SELECT COUNT(*) FROM "Tickets"',
        title: 'Open tickets',
        displayMode: 'scalar',
      },
      { queryId: '01992d2f-8444-7000-8000-000000000004', markdown }
    );
    expect(screen.getByText('Saved question')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByLabelText('Saved answer').textContent).toBe(markdown);
  });

  it('starts folded, since the reply pastes the same question', () => {
    const markdown =
      '<m-db-query>{"queryId":"01992d2f-8444-7000-8000-000000000004","title":"Open tickets","prompt":"How many open tickets?","displayMode":"scalar"}</m-db-query>';
    render(() => (
      <Dynamic
        component={
          databaseToolHandlers.SaveDatabaseQuery.render as Component<
            Record<string, unknown>
          >
        }
        tool={{
          id: 'tool-1',
          name: 'SaveDatabaseQuery',
          data: {
            databaseId,
            sql: 'SELECT COUNT(*) FROM "Tickets"',
            title: 'Open tickets',
            displayMode: 'scalar',
          },
        }}
        response={{
          id: 'tool-1',
          name: 'SaveDatabaseQuery',
          data: { queryId: '01992d2f-8444-7000-8000-000000000004', markdown },
        }}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete
        renderContext={{
          isStreaming: false,
          grouped: false,
          followedBy: () => false,
        }}
      />
    ));
    expect(screen.queryByLabelText('Saved answer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByLabelText('Saved answer').textContent).toBe(markdown);
  });

  it('shows the pending save before the output arrives', () => {
    renderTool(databaseToolHandlers.SaveDatabaseQuery, 'SaveDatabaseQuery', {
      sql: 'SELECT 1',
      title: 'One',
      displayMode: 'table',
    });
    expect(screen.getByText(/Save question/)).toBeTruthy();
    expect(screen.queryByLabelText('Saved answer')).toBeNull();
  });
});

describe('SaveDatabaseView', () => {
  it('rereads the database once the view is saved, not on each render', async () => {
    renderTool(databaseToolHandlers.SaveDatabaseView, 'SaveDatabaseView', {
      databaseId,
      tableId,
      name: 'Open',
      layout: { kind: 'table', columns: [] },
    });
    expect(invalidateDatabase).not.toHaveBeenCalled();
    await databaseToolHandlers.SaveDatabaseView.handleResponse?.({
      tool: {
        id: 'tool-1',
        name: 'SaveDatabaseView',
        data: { view: { id: 'view-1', databaseId }, created: true },
      },
      chat_id: 'chat-1',
      message_id: 'message-1',
      part_index: 0,
      isComplete: true,
    });
    expect(invalidateDatabase).toHaveBeenCalledExactlyOnceWith(databaseId);
  });
});

describe('DeleteDatabaseView', () => {
  it('rereads the database once the view is deleted', async () => {
    await databaseToolHandlers.DeleteDatabaseView.handleResponse?.({
      tool: {
        id: 'tool-1',
        name: 'DeleteDatabaseView',
        data: { databaseId, tableId, viewId: 'view-1', name: 'Stages' },
      },
      chat_id: 'chat-1',
      message_id: 'message-1',
      part_index: 0,
      isComplete: true,
    });
    expect(invalidateDatabase).toHaveBeenCalledWith(databaseId);
  });
});

describe('QueryDatabase results', () => {
  it('opens its results when nothing later in the turn saves them', () => {
    render(() => (
      <Dynamic
        component={
          databaseToolHandlers.QueryDatabase.render as Component<
            Record<string, unknown>
          >
        }
        tool={{
          id: 'tool-1',
          name: 'QueryDatabase',
          data: { databaseId, sql: 'SELECT COUNT(*) FROM "Invites"' },
        }}
        response={{
          id: 'tool-1',
          name: 'QueryDatabase',
          data: {
            results: [
              {
                columns: [{ name: 'Count', kind: 'number' }],
                rows: [[{ type: 'number', value: 12 }]],
                rowIds: [],
              },
            ],
            changesApplied: 0,
            readVersions: [{ tableId: invitesTableId, version: 4 }],
            statement: { kind: 'select' },
            summary: 'Returned 1 row.',
          },
        }}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete
        renderContext={{
          isStreaming: false,
          grouped: false,
          followedBy: () => false,
        }}
      />
    ));
    expect(screen.getByLabelText('Query results').dataset.sql).toBe(
      'SELECT COUNT(*) FROM "Invites"'
    );
  });

  it('folds its results when a later SaveDatabaseQuery shows them', () => {
    const followedBy = vi.fn((name: ToolName) => name === 'SaveDatabaseQuery');
    render(() => (
      <Dynamic
        component={
          databaseToolHandlers.QueryDatabase.render as Component<
            Record<string, unknown>
          >
        }
        tool={{
          id: 'tool-1',
          name: 'QueryDatabase',
          data: { databaseId, sql: 'SELECT COUNT(*) FROM "Invites"' },
        }}
        response={{
          id: 'tool-1',
          name: 'QueryDatabase',
          data: {
            results: [
              {
                columns: [{ name: 'Count', kind: 'number' }],
                rows: [[{ type: 'number', value: 12 }]],
                rowIds: [],
              },
            ],
            changesApplied: 0,
            readVersions: [{ tableId: invitesTableId, version: 4 }],
            statement: { kind: 'select' },
            summary: 'Returned 1 row.',
          },
        }}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete
        renderContext={{ isStreaming: false, grouped: false, followedBy }}
      />
    ));
    expect(followedBy).toHaveBeenCalledWith('SaveDatabaseQuery');
    expect(screen.queryByLabelText('Query results')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByLabelText('Query results').dataset.sql).toBe(
      'SELECT COUNT(*) FROM "Invites"'
    );
  });
});

describe('QueryDatabase with SQL hidden', () => {
  it('names the table a read used, never the statement', () => {
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      { databaseId, sql: 'SELECT COUNT(*) FROM "Invites"' },
      {
        results: [
          {
            columns: [{ name: 'Count', kind: 'number' }],
            rows: [[{ type: 'number', value: 12 }]],
            rowIds: [],
          },
        ],
        changesApplied: 0,
        readVersions: [{ tableId: invitesTableId, version: 4 }],
        statement: { kind: 'select' },
        summary: 'Returned 1 row.',
      }
    );
    expect(line(rendered)).toBe('Read Invites');
  });

  it('falls back to the database when a read names no table', () => {
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      { databaseId, sql: 'SELECT 1' },
      {
        results: [
          {
            columns: [{ name: '?column?', kind: 'number' }],
            rows: [[{ type: 'number', value: 1 }]],
            rowIds: [],
          },
        ],
        changesApplied: 0,
        readVersions: [],
        statement: { kind: 'select' },
        summary: 'Returned 1 row.',
      }
    );
    expect(line(rendered)).toBe('Queried Party Planner');
  });

  it('counts the rows an insert added to the table it wrote', () => {
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      {
        databaseId,
        sql: `INSERT INTO "Guests" ("Name") VALUES ('Ada')`,
      },
      {
        results: [],
        changesApplied: 1,
        insertedRowIds: ['01992d2f-8444-7000-8000-000000000010'],
        newVersions: { [guestsTableId]: 9 },
        readVersions: [],
        statement: {
          kind: 'insert',
          tableId: guestsTableId,
          tableName: 'Guests',
        },
        summary: 'Applied 1 row change.',
      }
    );
    expect(line(rendered)).toBe('Added 1 row to Guests');
  });

  it('counts the rows an update changed in the table it wrote', () => {
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      {
        databaseId,
        sql: `UPDATE "Guests" SET "Status" = 'Going' WHERE row_id = '1'`,
      },
      {
        results: [],
        changesApplied: 3,
        newVersions: { [guestsTableId]: 9 },
        readVersions: [],
        statement: {
          kind: 'update',
          tableId: guestsTableId,
          tableName: 'Guests',
        },
        summary: 'Applied 3 row changes.',
      }
    );
    expect(line(rendered)).toBe('Updated 3 rows in Guests');
  });

  it('says a delete that matched nothing removed no rows', () => {
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      {
        databaseId,
        sql: `DELETE FROM "Invites" WHERE "Status" = 'Declined'`,
      },
      {
        results: [],
        changesApplied: 0,
        newVersions: {},
        readVersions: [],
        statement: {
          kind: 'delete',
          tableId: invitesTableId,
          tableName: 'Invites',
        },
        summary: 'Applied 0 row changes.',
      }
    );
    expect(line(rendered)).toBe('Deleted no rows from Invites');
  });

  it('says which column a type change altered and into what', () => {
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      {
        databaseId,
        sql: 'ALTER TABLE "Items" ALTER COLUMN "Price" TYPE number',
      },
      {
        results: [],
        changesApplied: 0,
        newVersions: { [tableId]: 4 },
        readVersions: [],
        statement: {
          kind: 'alterColumnType',
          tableId,
          tableName: 'Items',
          columnId,
          columnName: 'Price',
          to: 'number',
        },
        summary: 'Changed "Price" to number.',
      }
    );
    expect(line(rendered)).toBe('Changed Price in Items to number');
  });

  it('keeps the server summary when SQL is shown', () => {
    showDatabaseSql.enabled = true;
    const rendered = renderTool(
      databaseToolHandlers.QueryDatabase,
      'QueryDatabase',
      { databaseId, sql: 'SELECT COUNT(*) FROM "Invites"' },
      {
        results: [
          {
            columns: [{ name: 'Count', kind: 'number' }],
            rows: [[{ type: 'number', value: 12 }]],
            rowIds: [],
          },
        ],
        changesApplied: 0,
        readVersions: [{ tableId: invitesTableId, version: 4 }],
        statement: { kind: 'select' },
        summary: 'Returned 1 row.',
      }
    );
    expect(line(rendered)).toBe('Returned 1 row.');
  });
});
