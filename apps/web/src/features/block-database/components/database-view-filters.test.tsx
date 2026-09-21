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

  it('switches to named choices for select properties and resets an incompatible value', () => {
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
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Filter property' }),
      { target: { value: 'status' } }
    );
    expect(filters()[0]).toMatchObject({
      columnId: 'status',
      operator: 'equals',
      value: '',
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter value' }), {
      target: { value: 'Done' },
    });
    expect(filters()[0].value).toBe('Done');
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Filter condition' }),
      { target: { value: 'is_empty' } }
    );
    expect(screen.queryByRole('combobox', { name: 'Filter value' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }));
    expect(filters()).toEqual([]);
  });
});
