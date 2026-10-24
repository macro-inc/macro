/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const [answer, setAnswer] = createSignal<unknown>(undefined);
const [failure, setFailure] = createSignal<unknown>(undefined);
const mocks = vi.hoisted(() => ({ statements: [] as unknown[] }));

vi.mock('@app/features/database-query/queries/app-query-source', () => ({
  createStatementSource: (statement: () => unknown) => {
    mocks.statements.push(statement());
    return {
      answer,
      error: failure,
      loading: () => !answer(),
      refresh: () => undefined,
    };
  },
}));
vi.mock('@queries/storage/databases', () => ({
  useViewerDatabases: () => ({
    databases: () => [
      { tables: [{ table: { id: 'table-deals', name: 'Deals' } }] },
    ],
    error: () => undefined,
  }),
}));
vi.mock('@app/features/database-query/answer-display', () => ({
  AppAnswerDisplay: (props: { children: unknown }) => props.children,
}));
vi.mock('@app/features/database-query/context/answer-display', () => ({
  useAnswerDisplay: () => ({ names: () => () => () => undefined }),
}));
vi.mock('@app/features/database-query/components/query-results', () => ({
  QueryResults: (props: { displayMode: string }) => (
    <div data-mode={props.displayMode}>results</div>
  ),
}));
vi.mock('@app/features/database-query/core/query-chart', () => ({
  availableDisplayModes: () => ['table', 'bar'],
}));

import { DataCard } from './data-card';

afterEach(() => {
  cleanup();
  setAnswer(undefined);
  setFailure(undefined);
  mocks.statements.length = 0;
});

const ANSWER = {
  columns: [],
  rows: [[], [], []],
  rowIds: [],
  readTables: ['table-deals'],
  readDatabaseIds: [],
  truncatedTables: [],
};

describe('a data card', () => {
  it("runs the agent's statement again, as the viewer", () => {
    render(() => <DataCard sql="SELECT 1" databaseId="db-1" display="bar" />);
    expect(mocks.statements).toEqual([{ sql: 'SELECT 1', databaseId: 'db-1' }]);
  });

  it('is named after the tables it reads, shown as the agent asked', () => {
    setAnswer(ANSWER);
    const view = render(() => <DataCard sql="SELECT 1" display="bar" />);
    expect(view.getByText('Deals')).toBeTruthy();
    expect(view.getByText('3 rows')).toBeTruthy();
    expect(view.getByText('results').getAttribute('data-mode')).toBe('bar');
  });

  it('falls back to a table when the asked-for chart cannot be drawn', () => {
    setAnswer(ANSWER);
    const view = render(() => <DataCard sql="SELECT 1" display="pie" />);
    expect(view.getByText('results').getAttribute('data-mode')).toBe('table');
  });

  it('says why it has no answer', () => {
    setFailure({ kind: 'databases', error: { message: 'Forbidden' } });
    const view = render(() => <DataCard sql="SELECT 1" />);
    expect(view.getByRole('alert')).toBeTruthy();
  });
});
