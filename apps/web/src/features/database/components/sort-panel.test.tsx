import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortPanel } from './sort-panel';

afterEach(cleanup);

describe('sort panel', () => {
  it('moves a sort level up from its handle, keeping its direction', () => {
    const change = vi.fn();
    render(() => (
      <SortPanel
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
          {
            id: 'due',
            name: 'Due',
            dataType: 'DATE',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: {
            filter: null,
            sort: [
              { column: 'name', direction: 'ascending' },
              { column: 'due', direction: 'descending' },
            ],
          },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        onChange={change}
      />
    ));
    const [, dueHandle] = screen.getAllByRole('button', {
      name: 'Reorder sort',
    });
    fireEvent.keyDown(dueHandle, { key: 'ArrowUp' });
    expect(change).toHaveBeenCalledExactlyOnceWith({
      query: {
        filter: null,
        sort: [
          { column: 'due', direction: 'descending' },
          { column: 'name', direction: 'ascending' },
        ],
      },
    });
    fireEvent.keyDown(dueHandle, { key: 'ArrowDown' });
    expect(change).toHaveBeenCalledOnce();
  });
});
