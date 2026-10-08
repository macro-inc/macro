import type {
  Formula,
  FormulaReading,
} from '@core/database-sql/generated/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
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
  it('builds a formula from the column and operator buttons and saves it with its name', async () => {
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
    const save = screen.getByRole('button', { name: 'Save' });
    // Only number and date columns are offered.
    expect(screen.queryByRole('button', { name: 'Name' })).toBeNull();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Unit price' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Multiply' }));
    expect(screen.getByText('The formula ends too soon.')).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Quantity' }));
    const input = screen.getByRole('textbox', {
      name: 'Formula',
    }) as HTMLInputElement;
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
