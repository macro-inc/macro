import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridCell } from '../component/GridCell';
import {
  type DatabaseViewColumn,
  defaultDatabaseView,
} from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { DatabaseTable } from './database-table';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  options: [],
  isMultiSelect: false,
  writable: true,
};
const notes: DatabaseViewColumn = { ...name, id: 'notes', name: 'Notes' };
const readonly: DatabaseViewColumn = {
  ...name,
  id: 'computed',
  name: 'Computed',
  writable: false,
};
const rows: DatabaseRow[] = [
  { rowId: 'one', cells: { name: 'First', notes: 'First note' } },
  { rowId: 'two', cells: { name: 'Second', notes: 'Second note' } },
];
function setup(canEdit = true) {
  const onOpen = vi.fn();
  const onDuplicate = vi.fn(async () => true);
  const onRequestDelete = vi.fn();
  const onWrite = vi.fn(
    async (_rowId: string, _columnId: string, _value: unknown) => true
  );
  const [columns, setColumns] = createSignal([name, readonly, notes]);
  const [records, setRecords] = createSignal(rows);
  const [unsavedRow, setUnsavedRow] = createSignal<string>();
  const [editCell, setEditCell] = createSignal<{
    rowId: string;
    columnId: string;
  }>();
  render(() => (
    <DatabaseTable
      name="Tasks"
      rows={records()}
      isUnsavedRow={(rowId) => rowId === unsavedRow()}
      columns={columns()}
      titleColumnId="name"
      view={defaultDatabaseView()}
      canEdit={canEdit}
      canCreateRecord
      pending={false}
      addColumn={<button>Add column</button>}
      editCell={editCell()}
      getRowTitle={(row) => String(row.cells.name)}
      onOpen={onOpen}
      onDuplicate={onDuplicate}
      onRequestDelete={onRequestDelete}
      onCreate={vi.fn()}
      onSort={vi.fn()}
      renderCell={(row, column, options) => (
        <GridCell
          column={column()}
          value={row().cells[column().id] ?? null}
          canEdit={canEdit}
          onWrite={(value) => onWrite(row().rowId, column().id, value)}
          onAddOption={async () => true}
          {...options}
        />
      )}
    />
  ));
  return {
    onOpen,
    onDuplicate,
    onRequestDelete,
    onWrite,
    setColumns,
    setEditCell,
    setRecords,
    setUnsavedRow,
  };
}
async function selectMenu(name: string) {
  const item = await screen.findByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // JSDOM reports an empty animation name; presence expects CSS's default none.
  menuStyles = document.createElement('style');
  menuStyles.textContent = '[role=menu] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.restoreAllMocks();
});

describe('spreadsheet interactions', () => {
  it('saves with Enter, moves Down, and types into the next row while the first save is pending', async () => {
    const { onWrite, setRecords } = setup();
    let finishSave!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    onWrite.mockImplementation(async (rowId, columnId, value) => {
      if (rowId === 'one') await pending;
      setRecords((records) =>
        records.map((row) =>
          row.rowId === rowId
            ? { ...row, cells: { ...row.cells, [columnId]: String(value) } }
            : row
        )
      );
      return true;
    });
    screen.getByRole('button', { name: /Name: First\./ }).focus();
    await userEvent.keyboard('Alpha{Enter}{ArrowDown}Beta{Enter}');
    expect(onWrite.mock.calls).toEqual([
      ['one', 'name', 'Alpha'],
      ['two', 'name', 'Beta'],
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Beta\./ })
    );
    finishSave();
    await screen.findByRole('button', { name: /Name: Alpha\./ });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Beta\./ })
    );
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Alpha\./ })
    );
  });

  it('moves through select cells with arrows and opens options only when editing', async () => {
    const { setColumns, onWrite } = setup();
    setColumns([
      name,
      {
        ...notes,
        dataType: 'SELECT_STRING',
        options: ['First note', 'Second note'],
      },
    ]);
    const first = screen.getByRole('button', { name: 'Notes: First note' });
    const second = screen.getByRole('button', { name: 'Notes: Second note' });
    first.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Search Notes options' })
      )
    );
    await userEvent.keyboard('{Escape}{ArrowDown}');
    expect(document.activeElement).toBe(second);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('opens select editing in a scrolling grid when the document itself cannot scroll', async () => {
    const getComputedStyle = window.getComputedStyle.bind(window);
    const { setColumns } = setup();
    setColumns([
      { ...name, dataType: 'SELECT_STRING', options: ['First', 'Done'] },
    ]);
    const grid = screen.getByRole('grid');
    grid.style.overflow = 'auto';
    document.documentElement.style.overflow = 'hidden';
    let scrollParentReads = 0;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      // Fail a repeated same-parent walk before a vendor scroll loop blocks
      // the test runner. A normal focus/open needs only a few layout reads.
      if (element === grid && ++scrollParentReads > 100)
        throw new Error('Repeated the same scroll parent');
      return getComputedStyle(element);
    });
    try {
      screen.getByRole('button', { name: 'Name: First' }).focus();
      await userEvent.keyboard('{Enter}Done');
      const input = screen.getByRole('textbox', {
        name: 'Search Name options',
      }) as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Done');
    } finally {
      document.documentElement.style.removeProperty('overflow');
    }
  });

  it('can navigate into and out of the empty row gutter without creating a record', async () => {
    const { setRecords, setUnsavedRow, onWrite, onOpen } = setup();
    setUnsavedRow('draft');
    setRecords([...rows, { rowId: 'draft', cells: {} }]);
    screen.getByRole('button', { name: 'Open Second' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('data-grid-row')).toBe('2');
    expect(document.activeElement?.getAttribute('data-grid-column')).toBe('0');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Empty\./ })
    );
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Second\./ })
    );
    expect(onWrite).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('types through consecutive select fields after Tab without exposing menu keyboard shortcuts', async () => {
    const { setColumns, onWrite } = setup();
    setColumns([
      { ...name, dataType: 'SELECT_STRING', options: ['First', 'Done'] },
      { ...notes, dataType: 'SELECT_STRING', options: ['First note', 'High'] },
      { ...readonly, writable: true },
    ]);
    screen.getByRole('button', { name: 'Name: First' }).focus();
    await userEvent.keyboard('Done{Tab}High{Tab}Final note{Enter}');
    expect(onWrite.mock.calls).toEqual([
      ['one', 'name', 'Done'],
      ['one', 'notes', 'High'],
      ['one', 'computed', 'Final note'],
    ]);
    expect(screen.queryByRole('menu')).toBeNull();

    screen.getByRole('button', { name: 'Notes: First note' }).focus();
    await userEvent.keyboard('{Enter}High{Enter}');
    expect(onWrite).toHaveBeenLastCalledWith('one', 'notes', 'High');
  });

  it('keeps invalid numeric edits in place and permits arrow navigation after Escape', async () => {
    const { setColumns, onWrite } = setup();
    setColumns([{ ...name, dataType: 'NUMBER' }, notes]);
    screen.getByRole('button', { name: /Name: First\./ }).focus();
    await userEvent.keyboard('invalid{Enter}{ArrowDown}');
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid number');
    expect(onWrite).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Second\./ })
    );
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('types directly, saves with Tab, skips read-only fields, and wraps rows', async () => {
    const { onWrite } = setup();
    const first = screen.getByRole('button', { name: /Name: First\./ });
    first.focus();
    fireEvent.keyDown(first, { key: 'A' });
    const nameInput = await screen.findByRole('textbox', { name: 'Edit Name' });
    expect((nameInput as HTMLInputElement).value).toBe('A');
    fireEvent.keyDown(nameInput, { key: 'Tab' });
    const notesInput = await screen.findByRole('textbox', {
      name: 'Edit Notes',
    });
    await waitFor(() => expect(document.activeElement).toBe(notesInput));
    expect(onWrite).toHaveBeenCalledWith('one', 'name', 'A');
    fireEvent.input(notesInput, { target: { value: 'Updated note' } });
    fireEvent.keyDown(notesInput, { key: 'Tab' });
    const nextName = await screen.findByRole('textbox', { name: 'Edit Name' });
    await waitFor(() => expect(document.activeElement).toBe(nextName));
    expect((nextName as HTMLInputElement).value).toBe('Second');
    expect(onWrite).toHaveBeenCalledWith('one', 'notes', 'Updated note');
    fireEvent.keyDown(nextName, { key: 'Tab', shiftKey: true });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Edit Notes' })
      )
    );
  });

  it('keeps editors mounted through schema refresh and focuses requested new rows', async () => {
    const { setColumns, setEditCell } = setup();
    setEditCell({ rowId: 'two', columnId: 'name' });
    const input = await screen.findByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: 'Unsaved draft' } });
    setColumns([{ ...name }, { ...notes }, { ...readonly }]);
    expect(screen.getByRole('textbox', { name: 'Edit Name' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('Unsaved draft');
    expect(document.activeElement).toBe(input);
  });

  it('moves through checkbox cells with arrow keys without changing their values', async () => {
    const { setColumns, onWrite, onOpen } = setup();
    setColumns([
      name,
      { ...name, id: 'done', name: 'Done', dataType: 'BOOLEAN' },
      notes,
    ]);
    const [firstCheckbox, secondCheckbox] = screen.getAllByRole('checkbox', {
      name: 'Done',
    });
    const firstName = screen.getByRole('button', { name: /Name: First\./ });
    firstName.focus();
    fireEvent.keyDown(firstName, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(firstCheckbox);
    fireEvent.keyDown(firstCheckbox, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(secondCheckbox);
    fireEvent.keyDown(secondCheckbox, { key: 'ArrowRight' });
    const secondNote = screen.getByRole('button', {
      name: /Notes: Second note\./,
    });
    expect(document.activeElement).toBe(secondNote);
    fireEvent.keyDown(secondNote, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(secondCheckbox);
    fireEvent.keyDown(secondCheckbox, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(firstCheckbox);
    expect(onWrite).not.toHaveBeenCalled();

    fireEvent.keyDown(firstCheckbox, { key: 'F10', shiftKey: true });
    await selectMenu('Open record');
    await waitFor(() => expect(onOpen).toHaveBeenCalledExactlyOnceWith('one'));
  });

  it('navigates read-only checkbox and select values without enabling their editors', async () => {
    const { setColumns, onWrite } = setup(false);
    setColumns([
      name,
      { ...name, id: 'done', name: 'Done', dataType: 'BOOLEAN' },
      {
        ...notes,
        dataType: 'SELECT_STRING',
        options: ['First note', 'Second note'],
      },
    ]);
    screen.getByRole('button', { name: /Name: First/ }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowDown}');
    const checkbox = screen.getAllByRole('checkbox', {
      name: 'Done',
    })[1] as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(document.activeElement).toBe(checkbox.parentElement);
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(document.activeElement?.textContent).toBe('Second note');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('opens context actions for the exact row and edits without opening a record', async () => {
    const { onDuplicate, onOpen } = setup();
    fireEvent.contextMenu(
      screen.getByRole('button', { name: /Notes: Second note\./ })
    );
    await selectMenu('Edit cell');
    const input = await screen.findByRole('textbox', { name: 'Edit Notes' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((input as HTMLInputElement).value).toBe('Second note');
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.contextMenu(
      screen.getByRole('button', { name: /Notes: Second note\./ })
    );
    await selectMenu('Duplicate');
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith('two'));
  });

  it('supports keyboard actions and deletes only the selected row', async () => {
    const { onRequestDelete } = setup();
    const second = screen.getByRole('button', { name: /Name: Second\./ });
    second.focus();
    fireEvent.keyDown(second, { key: 'F10', shiftKey: true });
    await selectMenu('Delete record');
    await waitFor(() => expect(onRequestDelete).toHaveBeenCalledWith('two'));
  });

  it('retains native text menus and hides write actions for viewers', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Name: First\./ }));
    expect(
      fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Edit Name' }))
    ).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();
    setup(false);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Second' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
    expect(
      within(menu).getByRole('menuitem', { name: 'Open record' })
    ).toBeTruthy();
  });
});
