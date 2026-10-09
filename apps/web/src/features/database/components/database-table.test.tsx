import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { DatabaseTableView as DatabaseTable } from '../views/database-table-view';
import type { DatabaseTableControls } from './database-table';
import { GridCell } from './grid-cell';

// JSDOM has no intersection observer to drive the date selector's focus.
vi.mock('@property/utils/focus', () => ({
  useSearchInputFocus: (input: () => HTMLElement | undefined) =>
    setTimeout(() => input()?.focus(), 100),
}));
vi.mock('../../../lib/core/user/index', () => ({
  tryMacroId: (id: string) => (id.startsWith('macro|') ? id : undefined),
  macroIdToEmail: (id: string) => id.slice(6),
  getDisplayNameParts: (id: string | undefined) =>
    id === 'macro|alex@example.com'
      ? { firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera' }
      : { firstName: '', lastName: '', fullName: '' },
  getInitials: (first: string, last: string, email: string) =>
    (first[0] ?? '') + (last[0] ?? '') || email[0].toUpperCase(),
}));

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
  const onAddColumnMount = vi.fn();
  function AddColumn() {
    onAddColumnMount();
    return <button>Add column</button>;
  }
  const onOpen = vi.fn();
  const onClearCells = vi.fn(async () => true);
  const onCellFocus = vi.fn();
  const onDuplicate = vi.fn(async () => true);
  const onRequestDelete = vi.fn();
  const onReorderColumn = vi.fn(async () => {});
  const onRenameColumn = vi.fn(
    (_columnId: string, _name: string, _previousName: string) =>
      okAsync(undefined)
  );
  const onWrite = vi.fn(
    async (_rowId: string, _columnId: string, _value: unknown) => true
  );
  const [columns, setColumns] = createSignal([name, readonly, notes]);
  const [records, setRecords] = createSignal(rows);
  const [unsavedRow, setUnsavedRow] = createSignal<string>();
  let controls!: DatabaseTableControls;
  render(() => (
    <DatabaseTable
      name="Tasks"
      rows={records()}
      isUnsavedRow={(rowId) => rowId === unsavedRow()}
      columns={columns()}
      titleColumnId="name"
      sort={[]}
      widths={{}}
      canEdit={canEdit}
      pending={false}
      addColumn={<AddColumn />}
      controlsRef={(tableControls) => {
        controls = tableControls;
      }}
      getRowTitle={(row) => String(row.cells.name)}
      onOpen={onOpen}
      onClearCells={onClearCells}
      onCellFocus={onCellFocus}
      onDuplicate={onDuplicate}
      onRequestDelete={onRequestDelete}
      onReorderColumn={onReorderColumn}
      onRenameColumn={onRenameColumn}
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
    onAddColumnMount,
    onOpen,
    onClearCells,
    onCellFocus,
    onDuplicate,
    onRequestDelete,
    onReorderColumn,
    onRenameColumn,
    onWrite,
    setColumns,
    controls,
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
  Element.prototype.scrollIntoView = vi.fn();
  // JSDOM reports an empty animation name; presence expects CSS's default none.
  menuStyles = document.createElement('style');
  menuStyles.textContent =
    '[role=menu], [role=dialog] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.restoreAllMocks();
});

describe('spreadsheet interactions', () => {
  it('creates the add-column control once across grid layout and row updates', () => {
    const fixture = setup();
    expect(fixture.onAddColumnMount).toHaveBeenCalledOnce();
    fixture.setRecords([...rows, { rowId: 'three', cells: { name: 'Third' } }]);
    expect(fixture.onAddColumnMount).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button', { name: 'Add column' })).toHaveLength(
      1
    );
  });

  function dragGeometry(scrollLeft = () => 0) {
    const positions: Record<string, number> = {
      Name: 40,
      Computed: 240,
      Notes: 440,
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const position = positions[this.getAttribute('aria-label') ?? ''];
        const x = position === undefined ? undefined : position - scrollLeft();
        return new DOMRect(
          x ?? 0,
          100,
          x === undefined ? 640 : 200,
          x === undefined ? 400 : 40
        );
      }
    );
  }

  it('previews the pointer boundary and drops on that exact side, without no-op indicators', async () => {
    dragGeometry();
    const { onReorderColumn } = setup();
    const title = screen
      .getByRole('columnheader', { name: 'Name' })
      .querySelector('span:not([aria-hidden])')!;
    fireEvent.mouseDown(title, { button: 0, clientX: 70, clientY: 120 });
    // The near half of the next column is still the original slot.
    fireEvent.mouseMove(document, { clientX: 260, clientY: 120 });
    expect(document.querySelector('[data-column-drop-indicator]')).toBeNull();
    fireEvent.mouseMove(document, { clientX: 420, clientY: 120 });
    await waitFor(() => {
      const line = document.querySelector<HTMLElement>(
        '[data-column-drop-indicator]'
      );
      expect(line?.dataset.dropEdge).toBe('after');
      expect(line?.style.left).toBe('440px');
    });
    fireEvent.mouseUp(document, { button: 0, clientX: 420, clientY: 120 });
    expect(onReorderColumn).toHaveBeenCalledWith('name', 'computed', 'after');
    expect(document.querySelector('[data-column-drop-indicator]')).toBeNull();
  });

  it('drops before a column when dragging left, and cancels on Escape without restarting', async () => {
    dragGeometry();
    const { onReorderColumn } = setup();
    const title = screen
      .getByRole('columnheader', { name: 'Notes' })
      .querySelector('span:not([aria-hidden])')!;
    fireEvent.mouseDown(title, { button: 0, clientX: 470, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 120 });
    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>('[data-column-drop-indicator]')
          ?.dataset.dropEdge
      ).toBe('before')
    );
    fireEvent.mouseUp(document, { button: 0, clientX: 70, clientY: 120 });
    expect(onReorderColumn).toHaveBeenCalledWith('notes', 'name', 'before');
    onReorderColumn.mockClear();
    fireEvent.mouseDown(title, { button: 0, clientX: 470, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 120 });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 120 });
    expect(document.querySelector('[data-column-drop-indicator]')).toBeNull();
    fireEvent.mouseUp(document, { button: 0, clientX: 100, clientY: 120 });
    expect(onReorderColumn).not.toHaveBeenCalled();
  });

  it('keeps the drop target when the pointer drifts below the header into the rows', async () => {
    dragGeometry();
    const { onReorderColumn } = setup();
    const title = within(
      screen.getByRole('columnheader', { name: 'Name' })
    ).getByText('Name');
    fireEvent.mouseDown(title, { button: 0, clientX: 70, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 420, clientY: 200 });
    await waitFor(() =>
      expect(
        document.querySelector('[data-column-drop-indicator]')
      ).not.toBeNull()
    );
    fireEvent.mouseUp(document, { button: 0, clientX: 420, clientY: 200 });
    expect(onReorderColumn).toHaveBeenCalledWith('name', 'computed', 'after');
  });

  it('clears the drop preview and leaves order unchanged outside the grid', async () => {
    dragGeometry();
    const { onReorderColumn } = setup();
    const title = screen
      .getByRole('columnheader', { name: 'Name' })
      .querySelector('span:not([aria-hidden])')!;
    fireEvent.mouseDown(title, { button: 0, clientX: 70, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 420, clientY: 120 });
    await waitFor(() =>
      expect(
        document.querySelector('[data-column-drop-indicator]')
      ).not.toBeNull()
    );
    fireEvent.mouseMove(document, { clientX: 420, clientY: 80 });
    expect(document.querySelector('[data-column-drop-indicator]')).toBeNull();
    fireEvent.mouseUp(document, { button: 0, clientX: 420, clientY: 80 });
    expect(onReorderColumn).not.toHaveBeenCalled();
  });

  it('cancels a drop when scrolling clips its insertion boundary out of view', async () => {
    let scrollLeft = 0;
    dragGeometry(() => scrollLeft);
    const { onReorderColumn } = setup();
    const title = within(
      screen.getByRole('columnheader', { name: 'Notes' })
    ).getByText('Notes');
    fireEvent.mouseDown(title, { button: 0, clientX: 470, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 120 });
    await waitFor(() =>
      expect(
        document.querySelector('[data-column-drop-indicator]')
      ).not.toBeNull()
    );
    scrollLeft = 70;
    fireEvent.scroll(screen.getByRole('grid').parentElement!);
    expect(document.querySelector('[data-column-drop-indicator]')).toBeNull();
    fireEvent.mouseUp(document, { button: 0, clientX: 50, clientY: 120 });
    expect(onReorderColumn).not.toHaveBeenCalled();
  });

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
        options: [
          { id: 'first-note', label: 'First note', color: null },
          { id: 'second-note', label: 'Second note', color: null },
        ],
      },
    ]);
    const first = screen.getByRole('button', { name: 'Notes: First note' });
    const second = screen.getByRole('button', { name: 'Notes: Second note' });
    first.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{Enter}');
    expect(
      await screen.findByRole('listbox', { name: 'Notes options' })
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('combobox', { name: 'Search Notes options' })
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
      {
        ...name,
        dataType: 'SELECT_STRING',
        options: [
          { id: 'first', label: 'First', color: null },
          { id: 'done', label: 'Done', color: null },
        ],
      },
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
      const input = screen.getByRole('combobox', {
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

  it('saves with Down from the last record and starts editing the new-record row', async () => {
    const { setRecords, setUnsavedRow, onWrite } = setup();
    setUnsavedRow('draft');
    setRecords([...rows, { rowId: 'draft', cells: {} }]);
    screen.getByRole('button', { name: /Name: Second\./ }).focus();
    await userEvent.keyboard('{Enter}Renamed{ArrowDown}');
    expect(onWrite.mock.calls).toEqual([['two', 'name', 'Renamed']]);
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Edit Name' })
    );
    expect(
      document.activeElement?.closest<HTMLElement>('[data-grid-row-id]')
        ?.dataset.gridRowId
    ).toBe('draft');
  });

  it('keeps an unsaved edit in place while someone else saves another cell of that row', async () => {
    const { setRecords, onWrite } = setup();
    screen.getByRole('button', { name: /Name: First\./ }).focus();
    await userEvent.keyboard('{Enter}Half typed');
    const input = screen.getByRole('textbox', {
      name: 'Edit Name',
    }) as HTMLInputElement;
    setRecords([
      { rowId: 'one', cells: { name: 'First', notes: 'Changed elsewhere' } },
      rows[1],
    ]);
    expect(screen.getByRole('textbox', { name: 'Edit Name' })).toBe(input);
    expect(input.value).toBe('Half typed');
    expect(document.activeElement).toBe(input);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('steps Down onto the new-record row already editing it', async () => {
    const { setRecords, setUnsavedRow, onWrite } = setup();
    setUnsavedRow('draft');
    setRecords([...rows, { rowId: 'draft', cells: {} }]);
    screen.getByRole('button', { name: /Name: Second\./ }).focus();
    await userEvent.keyboard('{ArrowDown}Third{Enter}');
    expect(onWrite.mock.calls).toEqual([['draft', 'name', 'Third']]);
  });

  it('types through consecutive select fields after Tab without exposing menu keyboard shortcuts', async () => {
    const { setColumns, onWrite } = setup();
    setColumns([
      {
        ...name,
        dataType: 'SELECT_STRING',
        options: [
          { id: 'first', label: 'First', color: null },
          { id: 'done', label: 'Done', color: null },
        ],
      },
      {
        ...notes,
        dataType: 'SELECT_STRING',
        options: [
          { id: 'first-note', label: 'First note', color: null },
          { id: 'high', label: 'High', color: null },
        ],
      },
      { ...readonly, writable: true },
    ]);
    screen.getByRole('button', { name: 'Name: First' }).focus();
    await userEvent.keyboard('Done{Tab}High{Tab}Final note{Enter}');
    expect(onWrite.mock.calls).toEqual([
      ['one', 'name', 'Done'],
      ['one', 'notes', 'High'],
      ['one', 'computed', 'Final note'],
    ]);
    expect(screen.queryByRole('listbox')).toBeNull();

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
    const { setColumns, controls } = setup();
    controls.editCell('two', 'name');
    const input = await screen.findByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: 'Unsaved draft' } });
    setColumns([{ ...name }, { ...notes }, { ...readonly }]);
    expect(screen.getByRole('textbox', { name: 'Edit Name' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('Unsaved draft');
    expect(document.activeElement).toBe(input);
  });

  it('opens a requested cell editor once that row mounts', async () => {
    const { setRecords, controls } = setup();
    controls.editCell('three', 'notes');
    expect(screen.queryByRole('textbox')).toBeNull();
    setRecords([
      { rowId: 'one', cells: { name: 'First', notes: 'First note' } },
      { rowId: 'two', cells: { name: 'Second', notes: 'Second note' } },
      { rowId: 'three', cells: { name: 'Third', notes: 'Third note' } },
    ]);
    const input = await screen.findByRole('textbox', { name: 'Edit Notes' });
    expect((input as HTMLInputElement).value).toBe('Third note');
    expect(document.activeElement).toBe(input);
  });

  it('renames a requested column header once it mounts, and one already mounted at once', async () => {
    const { setColumns, controls } = setup();
    controls.renameColumn('status');
    expect(screen.queryByRole('textbox', { name: 'Column name' })).toBeNull();
    setColumns([
      name,
      readonly,
      notes,
      {
        id: 'status',
        name: 'Status',
        dataType: 'STRING',
        options: [],
        isMultiSelect: false,
        writable: true,
      },
    ]);
    const statusInput = await screen.findByRole('textbox', {
      name: 'Column name',
    });
    await waitFor(() => expect(document.activeElement).toBe(statusInput));
    expect((statusInput as HTMLInputElement).value).toBe('Status');
    fireEvent.keyDown(statusInput, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Column name' })).toBeNull()
    );

    controls.renameColumn('notes');
    const notesInput = await screen.findByRole('textbox', {
      name: 'Column name',
    });
    await waitFor(() => expect(document.activeElement).toBe(notesInput));
    expect((notesInput as HTMLInputElement).value).toBe('Notes');
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
        options: [
          { id: 'first-note', label: 'First note', color: null },
          { id: 'second-note', label: 'Second note', color: null },
        ],
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
    expect(screen.queryByRole('listbox')).toBeNull();
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

describe('presence and reveal', () => {
  it('marks the cell a remote viewer is on and shares the focused cell', () => {
    const onCellFocus = vi.fn();
    const [remoteUsers, setRemoteUsers] = createSignal([
      {
        userId: 'macro|alex@example.com',
        rowId: 'two',
        columnId: 'notes',
        editing: false,
      },
      {
        userId: 'macro|sam@example.com',
        rowId: 'one',
        columnId: 'name',
        editing: true,
      },
      { userId: 'macro|pat@example.com', editing: false },
    ]);
    const [highlightRowId, setHighlightRowId] = createSignal<string>();
    render(() => (
      <DatabaseTable
        name="Tasks"
        rows={rows}
        columns={[name, notes]}
        titleColumnId="name"
        sort={[]}
        widths={{}}
        canEdit
        pending={false}
        addColumn={<button>Add column</button>}
        getRowTitle={(row) => String(row.cells.name)}
        onOpen={vi.fn()}
        onSort={vi.fn()}
        onCellFocus={onCellFocus}
        remoteUsers={remoteUsers()}
        highlightRowId={highlightRowId()}
        renderCell={(row, column, options) => (
          <GridCell
            column={column()}
            value={row().cells[column().id] ?? null}
            canEdit
            onWrite={async () => true}
            onAddOption={async () => true}
            {...options}
          />
        )}
      />
    ));
    const alexTag = screen.getByRole('note', { name: 'Alex is here' });
    expect(alexTag.textContent).toBe('Alex');
    expect(alexTag.title).toBe('Alex is here');
    const alexCell = alexTag.closest<HTMLElement>('[data-grid-cell]')!;
    expect(alexCell.dataset.gridRow).toBe('1');
    expect(alexCell.dataset.gridColumn).toBe('2');
    expect(alexCell.dataset.remoteUsers).toBe('macro|alex@example.com');
    expect(alexCell.style.borderTop).toContain('2px solid');
    expect(alexCell.style.backgroundColor).toContain('color-mix');
    // Sam has no cached profile: the email name is shown, dashed while editing.
    const samTag = screen.getByRole('note', { name: 'Sam is editing' });
    const samCell = samTag.closest<HTMLElement>('[data-grid-cell]')!;
    expect(samCell.style.borderTop).toContain('dashed');
    expect(samCell.style.borderTop).not.toBe(alexCell.style.borderTop);
    // Pat is on the table with no cell: nothing to draw.
    expect(document.querySelectorAll('[data-remote-users]')).toHaveLength(2);
    setRemoteUsers([]);
    expect(screen.queryByRole('note')).toBeNull();
    expect(alexCell.style.borderTop).toBe('');

    const secondNotes = screen
      .getAllByRole('row')[2]
      .querySelectorAll('[data-grid-cell]')[2];
    within(secondNotes as HTMLElement)
      .getByRole('button')
      .focus();
    expect(onCellFocus).toHaveBeenLastCalledWith({
      rowId: 'two',
      columnId: 'notes',
      editing: false,
    });

    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    setHighlightRowId('two');
    const row = screen.getAllByRole('row')[2];
    expect(row.dataset.highlighted).toBe('');
    expect(scrollIntoView).toHaveBeenCalled();
    setHighlightRowId(undefined);
    expect(row.dataset.highlighted).toBeUndefined();
  });
});

describe('sort and column widths', () => {
  it('marks the sorted header, sizes columns from their widths and resizes by dragging a header edge', () => {
    const onResizeColumn = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 40)
    );
    render(() => (
      <DatabaseTable
        name="Tasks"
        rows={rows}
        columns={[name, notes]}
        titleColumnId="name"
        sort={[{ column: 'notes', direction: 'descending' }]}
        widths={{ name: null, notes: 300 }}
        onResizeColumn={onResizeColumn}
        canEdit
        pending={false}
        addColumn={<button>Add column</button>}
        getRowTitle={(row) => String(row.cells.name)}
        onOpen={vi.fn()}
        onSort={vi.fn()}
        renderCell={(row, column, options) => (
          <GridCell
            column={column()}
            value={row().cells[column().id] ?? null}
            canEdit
            onWrite={async () => true}
            onAddOption={async () => true}
            {...options}
          />
        )}
      />
    ));
    expect(
      screen
        .getByRole('columnheader', { name: 'Notes' })
        .getAttribute('aria-sort')
    ).toBe('descending');
    expect(
      screen
        .getByRole('columnheader', { name: 'Name' })
        .getAttribute('aria-sort')
    ).toBe('none');
    const headerRow = screen.getAllByRole('row')[0];
    expect(headerRow.style.gridTemplateColumns).toContain('300px');

    const separator = screen.getByRole('separator', { name: 'Resize Name' });
    // JSDOM has no layout; the header measures 200px wide.
    separator.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 200 })
    );
    separator.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 250 })
    );
    expect(headerRow.style.gridTemplateColumns).toMatch(
      /^2\.75rem 250px 300px/
    );
    expect(onResizeColumn).not.toHaveBeenCalled();
    separator.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 260 })
    );
    expect(onResizeColumn).toHaveBeenCalledExactlyOnceWith('name', 260);
  });
});

it('selects a rectangle with Shift-click, announces both corners and clears the cells together', async () => {
  const { onClearCells, onCellFocus, onWrite } = setup();
  const first = document.querySelector<HTMLElement>(
    '[data-grid-row-id="one"] [data-grid-column="1"]'
  )!;
  const last = document.querySelector<HTMLElement>(
    '[data-grid-row-id="two"] [data-grid-column="3"]'
  )!;
  first.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, button: 0 })
  );
  document.dispatchEvent(
    new MouseEvent('pointerup', { bubbles: true, button: 0 })
  );
  last.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true })
  );
  expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(6);
  expect(onCellFocus).toHaveBeenLastCalledWith({
    rowId: 'one',
    columnId: 'name',
    endRowId: 'two',
    endColumnId: 'notes',
    editing: false,
  });
  fireEvent.keyDown(last, { key: 'Delete' });
  await waitFor(() =>
    expect(onClearCells).toHaveBeenCalledExactlyOnceWith(
      ['one', 'two'],
      ['name', 'computed', 'notes']
    )
  );
  expect(onWrite).not.toHaveBeenCalled();
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
});
