import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseFilter, DatabaseViewColumn } from '../core/database-view';
import { FilterPanel } from './database-view-filters';

afterEach(cleanup);

const columns: DatabaseViewColumn[] = [
  {
    id: 'name',
    name: 'Name',
    dataType: 'STRING',
    options: [],
    isMultiSelect: false,
    writable: true,
  },
  {
    id: 'status',
    name: 'Status',
    dataType: 'SELECT_STRING',
    options: ['To do', 'Done'],
    isMultiSelect: false,
    writable: true,
  },
  {
    id: 'amount',
    name: 'Amount',
    dataType: 'NUMBER',
    options: [],
    isMultiSelect: false,
    writable: true,
  },
];

describe('database filter controls', () => {
  it('keeps text input mounted and focused through successive filter edits', () => {
    const [filters, setFilters] = createSignal<DatabaseFilter[]>([]);
    render(() => (
      <FilterPanel
        columns={columns}
        filters={filters()}
        onChange={setFilters}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    const input = screen.getByRole('textbox', { name: 'Filter value' });
    input.focus();
    fireEvent.input(input, { target: { value: 'P' } });
    fireEvent.input(input, { target: { value: 'Priya' } });
    expect(screen.getByRole('textbox', { name: 'Filter value' })).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(filters()[0].value).toBe('Priya');
  });

  it('switches to named choices for select properties and resets an incompatible value', async () => {
    const [filters, setFilters] = createSignal<DatabaseFilter[]>([
      { id: '1', columnId: 'name', operator: 'contains', value: 'draft' },
    ]);
    render(() => (
      <FilterPanel
        columns={columns}
        filters={filters()}
        onChange={setFilters}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: /^Filter property/ }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Status' }), {
      key: 'Enter',
    });
    expect(filters()[0]).toMatchObject({
      columnId: 'status',
      operator: 'equals',
      value: '',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /^Filter value/ }), {
      key: 'Enter',
    });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Done' }), {
      key: 'Enter',
    });
    expect(filters()[0].value).toBe('Done');
    fireEvent.keyDown(
      screen.getByRole('button', { name: /^Filter condition/ }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(await screen.findByRole('option', { name: 'is empty' }), {
      key: 'Enter',
    });
    expect(screen.queryByRole('button', { name: /^Filter value/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }));
    expect(filters()).toEqual([]);
  });
});
