import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { errAsync, okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewChange } from '../core/view-state';
import { DatabaseToolbar } from './database-toolbar';

vi.mock('../../../lib/core/mobile/isMobile', () => ({ isMobile: () => false }));

let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
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
  vi.unstubAllGlobals();
});

describe('database toolbar views', () => {
  it('selects a stored view, and All records', () => {
    const select = vi.fn();
    render(() => (
      <DatabaseToolbar
        columns={[]}
        views={[
          {
            id: 'work',
            databaseId: 'database',
            tableId: 'table',
            name: 'My work',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
          {
            id: 'next',
            databaseId: 'database',
            tableId: 'table',
            name: 'Next week',
            position: 'a1',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId="work"
        canEdit
        onSelectView={select}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    expect(
      screen
        .getByRole('button', { name: 'My work' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'All records' })
        .getAttribute('aria-pressed')
    ).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(select).toHaveBeenLastCalledWith('next');
    fireEvent.click(screen.getByRole('button', { name: 'All records' }));
    expect(select).toHaveBeenLastCalledWith();
  });

  it('renames a view inline from a double click, saving on Enter', async () => {
    const rename = vi.fn(() => okAsync(undefined));
    const select = vi.fn();
    render(() => (
      <DatabaseToolbar
        columns={[]}
        views={[
          {
            id: 'work',
            databaseId: 'database',
            tableId: 'table',
            name: 'My work',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
          {
            id: 'next',
            databaseId: 'database',
            tableId: 'table',
            name: 'Next week',
            position: 'a1',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId="work"
        canEdit
        onSelectView={select}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={rename}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    const tab = screen.getByRole('button', { name: 'Next week' });
    fireEvent.dblClick(tab);
    const name = (await screen.findByRole('textbox', {
      name: 'View name',
    })) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.value).toBe('Next week');
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe('Next week'.length);
    fireEvent.input(name, { target: { value: '  Soon  ' } });
    // Enter in the input submits its form; JSDOM does not do that itself.
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'View name' })).toBeNull()
    );
    expect(rename).toHaveBeenCalledExactlyOnceWith(
      {
        id: 'next',
        databaseId: 'database',
        tableId: 'table',
        name: 'Next week',
        position: 'a1',
        query: { filter: null, sort: [] },
        layout: { kind: 'table', columns: [] },
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      },
      'Soon'
    );
    expect(select).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Next week' })
      )
    );
  });

  it('cancels an inline rename started with F2 on Escape', async () => {
    const rename = vi.fn(() => okAsync(undefined));
    render(() => (
      <DatabaseToolbar
        columns={[]}
        views={[
          {
            id: 'work',
            databaseId: 'database',
            tableId: 'table',
            name: 'My work',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId="work"
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={rename}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'My work' }), {
      key: 'F2',
    });
    const name = await screen.findByRole('textbox', { name: 'View name' });
    fireEvent.input(name, { target: { value: 'Abandoned' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'View name' })).toBeNull()
    );
    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'My work' })).toBeTruthy();
  });

  it('keeps the draft and says why when a rename is refused', async () => {
    const rename = vi.fn(() =>
      errAsync({
        kind: 'ops' as const,
        error: {
          code: 'INVALID_OP' as const,
          message: 'a view named `My work` already exists on this table',
          refusal: {
            op: 0,
            row: null,
            column: null,
            taken: null,
            message: 'a view named `My work` already exists on this table',
          },
        },
      })
    );
    render(() => (
      <DatabaseToolbar
        columns={[]}
        views={[
          {
            id: 'work',
            databaseId: 'database',
            tableId: 'table',
            name: 'My work',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
          {
            id: 'next',
            databaseId: 'database',
            tableId: 'table',
            name: 'Next week',
            position: 'a1',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId="work"
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={rename}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    fireEvent.dblClick(screen.getByRole('button', { name: 'Next week' }));
    const name = (await screen.findByRole('textbox', {
      name: 'View name',
    })) as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'My work' } });
    fireEvent.submit(name.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'a view named `My work` already exists on this table'
    );
    expect(rename).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole('textbox', { name: 'View name' }) as HTMLInputElement)
        .value
    ).toBe('My work');
  });

  it('deletes a view after confirming in the dialog', async () => {
    const remove = vi.fn(() => okAsync(undefined));
    render(() => (
      <DatabaseToolbar
        columns={[]}
        views={[
          {
            id: 'work',
            databaseId: 'database',
            tableId: 'table',
            name: 'My work',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
          {
            id: 'next',
            databaseId: 'database',
            tableId: 'table',
            name: 'Next week',
            position: 'a1',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId="work"
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={remove}
        onReorderViews={vi.fn()}
      />
    ));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Next week' }), {
      clientX: 100,
      clientY: 40,
    });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Delete view' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    await screen.findByRole('dialog', { name: 'Delete view?' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    expect(
      screen.getByText('“Next week” will be deleted for everyone.', {
        exact: false,
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledExactlyOnceWith({
        id: 'next',
        databaseId: 'database',
        tableId: 'table',
        name: 'Next week',
        position: 'a1',
        query: { filter: null, sort: [] },
        layout: { kind: 'table', columns: [] },
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete view?' })).toBeNull()
    );
  });

  it('turns a view into a board grouped by a new Status column from its tab menu', async () => {
    const showAs = vi.fn(() => okAsync(undefined));
    const grid: DatabaseView = {
      id: 'work',
      databaseId: 'database',
      tableId: 'table',
      name: 'My work',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: { kind: 'table', columns: [] },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    render(() => (
      <DatabaseToolbar
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        views={[grid]}
        view={grid}
        selectedViewId="work"
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={showAs}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My work' }), {
      clientX: 100,
      clientY: 40,
    });
    const board = await screen.findByRole('menuitem', {
      name: 'Show as board',
    });
    board.focus();
    fireEvent.keyDown(board, { key: 'ArrowRight' });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Create a Status column' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );

    await waitFor(() =>
      expect(showAs).toHaveBeenCalledExactlyOnceWith(grid, {
        kind: 'board',
        groupBy: { kind: 'new-status' },
      })
    );
  });

  it('creates a table view directly from the New view menu', async () => {
    const create = vi.fn(() => okAsync(undefined));
    render(() => (
      <DatabaseToolbar
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        views={[]}
        view={{
          id: 'table',
          databaseId: 'database',
          tableId: 'table',
          name: 'All records',
          position: '',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z',
        }}
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={create}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'New view' }), {
      key: 'Enter',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Table' }), {
      key: 'Enter',
    });
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledExactlyOnceWith({
      name: 'Table view',
      layout: 'table',
    });
  });
});

describe('database toolbar view controls', () => {
  it('adds a sort and changes its direction', async () => {
    const [view, setView] = createSignal<DatabaseView>({
      id: 'work',
      databaseId: 'database',
      tableId: 'table',
      name: 'My work',
      position: 'a0',
      query: {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
          ],
        },
        sort: [],
      },
      layout: { kind: 'table', columns: [] },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    });
    const change = vi.fn((next: ViewChange) => setView({ ...view(), ...next }));
    render(() => (
      <DatabaseToolbar
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
        views={[view()]}
        view={view()}
        selectedViewId="work"
        canEdit
        onSelectView={vi.fn()}
        onChangeView={change}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    expect(screen.getByRole('button', { name: 'Filter 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add sort' }));
    expect(change).toHaveBeenLastCalledWith({
      query: {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
          ],
        },
        sort: [{ column: 'name', direction: 'ascending' }],
      },
    });
    fireEvent.keyDown(
      await screen.findByRole('button', { name: /^Sort direction/ }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(
      await screen.findByRole('option', { name: 'Descending' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenLastCalledWith({
      query: {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
          ],
        },
        sort: [{ column: 'name', direction: 'descending' }],
      },
    });
    expect(screen.getByRole('button', { name: 'Sort 1' })).toBeTruthy();
  });

  it('shows viewers no view controls on a stored view, but keeps them on All records', () => {
    const [selected, setSelected] = createSignal<string | undefined>('work');
    render(() => (
      <DatabaseToolbar
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: false,
            options: [],
          },
        ]}
        views={[
          {
            id: 'work',
            databaseId: 'database',
            tableId: 'table',
            name: 'My work',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: { kind: 'table', columns: [] },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'work',
          databaseId: 'database',
          tableId: 'table',
          name: 'My work',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId={selected()}
        canEdit={false}
        onSelectView={setSelected}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sort' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New view' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'My work' }), {
      key: 'F2',
    });
    expect(screen.queryByRole('textbox', { name: 'View name' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All records' }));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort' })).toBeTruthy();
  });

  it('creates a record from a board’s New button', () => {
    const createRecord = vi.fn();
    const [creating, setCreating] = createSignal(false);
    render(() => (
      <DatabaseToolbar
        columns={[
          {
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            writable: true,
            options: [{ id: 'option-done', label: 'Done', color: null }],
          },
        ]}
        views={[
          {
            id: 'board',
            databaseId: 'database',
            tableId: 'table',
            name: 'Board',
            position: 'a0',
            query: { filter: null, sort: [] },
            layout: {
              kind: 'board',
              title: 'name',
              groupBy: 'status',
              lanes: [],
              cardFields: [],
              hideEmptyLanes: false,
            },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ]}
        view={{
          id: 'board',
          databaseId: 'database',
          tableId: 'table',
          name: 'Board',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: {
            kind: 'board',
            title: 'name',
            groupBy: 'status',
            lanes: [],
            cardFields: [],
            hideEmptyLanes: false,
          },
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        selectedViewId="board"
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
        onCreateRecord={createRecord}
        canCreateRecord
        creating={creating()}
      />
    ));
    const button = screen.getByRole('button', { name: 'New record' });
    expect(button.textContent).toBe('New');
    fireEvent.click(button);
    expect(createRecord).toHaveBeenCalledOnce();
    setCreating(true);
    const saving = screen.getByRole('button', {
      name: 'Saving record',
    }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.textContent).toBe('Saving…');
  });

  it('has no New button on a table view', () => {
    render(() => (
      <DatabaseToolbar
        columns={[]}
        views={[]}
        view={{
          id: 'table',
          databaseId: 'database',
          tableId: 'table',
          name: 'All records',
          position: '',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z',
        }}
        canEdit
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        onCreateView={vi.fn(() => okAsync(undefined))}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn()}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
        onCreateRecord={vi.fn()}
        canCreateRecord
      />
    ));
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
  });
});

describe('quick view creation and board grouping', () => {
  const view: DatabaseView = {
    id: 'board',
    databaseId: 'database',
    tableId: 'table',
    name: 'Board view',
    position: 'a0',
    query: { filter: null, sort: [] },
    layout: {
      kind: 'board',
      groupBy: 'priority',
      title: 'name',
      cardFields: ['name'],
      lanes: [],
      hideEmptyLanes: true,
    },
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
  const columns = ['Priority', 'Status'].map((name) => ({
    id: name.toLowerCase(),
    name,
    dataType: 'SELECT_STRING' as const,
    isMultiSelect: false,
    writable: true,
    options: [],
  }));
  function toolbar(
    options: { noGroups?: boolean; canEdit?: boolean; fail?: boolean } = {}
  ) {
    const create = vi.fn(() =>
      options.fail
        ? errAsync({
            kind: 'ops' as const,
            error: {
              code: 'NETWORK_ERROR' as const,
              message: 'Offline',
              refusal: null,
            },
          })
        : okAsync(undefined)
    );
    const change = vi.fn();
    render(() => (
      <DatabaseToolbar
        columns={options.noGroups ? [] : columns}
        views={[view]}
        view={view}
        selectedViewId={view.id}
        canEdit={options.canEdit ?? true}
        onSelectView={vi.fn()}
        onChangeView={change}
        onCreateView={create}
        onRenameView={vi.fn(() => okAsync(undefined))}
        onDeleteView={vi.fn(() => okAsync(undefined))}
        onShowViewAs={vi.fn(() => okAsync(undefined))}
        onReorderViews={vi.fn()}
      />
    ));
    return { create, change };
  }
  async function newBoard() {
    fireEvent.keyDown(screen.getByRole('button', { name: 'New view' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Board' }), {
      key: 'Enter',
    });
  }
  it('creates a uniquely named board with an existing grouping column', async () => {
    const { create } = toolbar();
    await newBoard();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      name: 'Board view 2',
      layout: 'board',
      groupBy: { kind: 'column', columnId: 'priority' },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('creates a Status column when no column can group a board', async () => {
    const { create } = toolbar({ noGroups: true });
    await newBoard();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      name: 'Board view 2',
      layout: 'board',
      groupBy: { kind: 'new-status' },
    });
  });
  it('reports a refused creation', async () => {
    toolbar({ fail: true });
    await newBoard();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('changes grouping after creation while preserving card settings', async () => {
    const { change } = toolbar();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Group board by' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(
      await screen.findByRole('menuitemradio', { name: 'Status' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenCalledExactlyOnceWith({
      layout: { ...view.layout, groupBy: 'status', lanes: [] },
    });
  });
  it('does not offer shared grouping changes to viewers', () => {
    toolbar({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'Group board by' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New view' })).toBeNull();
  });
});
