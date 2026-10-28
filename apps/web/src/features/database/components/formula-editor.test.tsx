import type {
  Formula,
  FormulaReading,
} from '@core/database-sql/generated/types';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import { FormulaEditor } from './formula-editor';

// The engine is wasm, which the test runner cannot load; this stands in for
// its reading of the one formula the tests type.
const total: Formula = {
  kind: 'binary',
  operator: 'multiply',
  left: { kind: 'column', column: 'price' },
  right: { kind: 'column', column: 'quantity' },
};
vi.mock('../core/formula', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/formula')>()),
  loadFormulaTools: async () => ({
    read: (text: string): FormulaReading =>
      text === '{Unit price} * Quantity'
        ? { status: 'valid', formula: total, result: 'number' }
        : {
            status: 'invalid',
            message: 'The formula ends too soon.',
            span: { start: text.length, end: text.length },
          },
    render: (formula: Formula) =>
      formula.kind === 'column' && formula.column === 'price'
        ? '{Unit price}'
        : 'Quantity',
  }),
}));

afterEach(cleanup);

const columns: DatabaseViewColumn[] = [
  {
    id: 'name',
    name: 'Name',
    dataType: 'STRING',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'price',
    name: 'Unit price',
    dataType: 'NUMBER',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'quantity',
    name: 'Quantity',
    dataType: 'NUMBER',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
];

describe('formula editor', () => {
  it('suggests columns as their names are typed and saves the formula with its name', async () => {
    const onSave = vi.fn(() => okAsync(undefined));
    render(() => (
      <FormulaEditor
        tableId="orders"
        columns={columns}
        name="Total"
        onSave={onSave}
        onCancel={() => {}}
      />
    ));
    const input = (await screen.findByRole('combobox', {
      name: 'Formula',
    })) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));

    await userEvent.type(input, 'un');
    const suggested = screen.getByRole('listbox', { name: 'Columns' });
    expect(
      within(suggested)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Unit price']);
    await userEvent.keyboard('{Enter}');
    expect(input.value).toBe('{Unit price}');
    expect(screen.queryByRole('listbox')).toBeNull();

    // Only number and date columns are suggested.
    await userEvent.type(input, ' * na');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('The formula ends too soon.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(input, '{Backspace}{Backspace}q');
    await userEvent.keyboard('{Tab}');
    expect(input.value).toBe('{Unit price} * Quantity');
    expect(screen.getByText('number')).toBeTruthy();

    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: 'Total',
      formula: total,
    });
  });

  it('edits an existing formula, saving on Enter only once it changed', async () => {
    const onSave = vi.fn(() => okAsync(undefined));
    render(() => (
      <FormulaEditor
        tableId="orders"
        columns={columns}
        own="total"
        formula={{ kind: 'column', column: 'quantity' }}
        onSave={onSave}
        onCancel={() => {}}
      />
    ));
    const input = (await screen.findByDisplayValue(
      'Quantity'
    )) as HTMLInputElement;
    expect(screen.queryByRole('textbox', { name: 'Column name' })).toBeNull();

    await userEvent.type(input, '{Enter}');
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, '{{Unit price} * Quantity{Enter}');
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: '',
      formula: total,
    });
  });
});
