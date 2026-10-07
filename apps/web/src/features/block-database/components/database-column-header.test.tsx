import type { DatabaseOpsError } from '@service-storage/databases';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { err, errAsync, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionEditingContext } from '../context/option-editing';
import type { DatabaseViewColumn } from '../core/database-view';
import { DatabaseColumnHeader } from './database-column-header';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
const column: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};

it('disables protected schema actions while keeping rename and movement available', async () => {
  const remove = vi.fn(() => okAsync(undefined));
  render(() => (
    <DatabaseColumnHeader
      column={{ ...column, protections: ['delete', 'change_type'] }}
      canRename
      onRename={vi.fn(() => okAsync(undefined))}
      onChangeType={vi.fn(() => okAsync(undefined))}
      onSort={vi.fn()}
      onDelete={remove}
      onMove={vi.fn()}
      canMoveRight
    />
  ));
  fireEvent.keyDown(screen.getByRole('columnheader', { name: 'Name' }), {
    key: 'Enter',
  });
  const deletion = await screen.findByRole('menuitem', {
    name: 'Delete column',
  });
  expect(deletion.getAttribute('aria-disabled')).toBe('true');
  expect(
    screen
      .getByRole('menuitem', { name: 'Change type' })
      .getAttribute('aria-disabled')
  ).toBe('true');
  expect(
    screen
      .getByRole('menuitem', { name: 'Move right' })
      .getAttribute('aria-disabled')
  ).not.toBe('true');
  expect(
    screen
      .getByRole('menuitem', { name: 'Rename column' })
      .getAttribute('aria-disabled')
  ).not.toBe('true');
  expect(remove).not.toHaveBeenCalled();
});
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
  // Match the browser's computed animation default so closed menus unmount.
  menuStyles = document.createElement('style');
  menuStyles.textContent =
    '[role=menu], [role=dialog] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
});

describe('column header interactions', () => {
  it('opens the same actions by right-click and keyboard, closes after selection, and focuses rename', async () => {
    const sort = vi.fn();
    render(() => (
      <DatabaseColumnHeader
        column={column}
        canRename
        onRename={vi.fn(() => okAsync(undefined))}
        onSort={sort}
      />
    ));
    const header = screen.getByRole('columnheader', { name: 'Name' });
    fireEvent.contextMenu(header, { clientX: 40, clientY: 20 });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Sort ascending' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    expect(sort).toHaveBeenCalledExactlyOnceWith('name', 'asc');
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    fireEvent.keyDown(header, { key: 'F10', shiftKey: true });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Rename column' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    const input = await screen.findByLabelText('Column name');
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Column name')).toBeNull();
  });

  it('offers inserting a column to either side for editors', async () => {
    const insert = vi.fn();
    render(() => (
      <DatabaseColumnHeader
        column={column}
        canRename
        onRename={vi.fn(() => okAsync(undefined))}
        onSort={vi.fn()}
        onInsert={insert}
      />
    ));
    const header = screen.getByRole('columnheader', { name: 'Name' });
    fireEvent.contextMenu(header, { clientX: 40, clientY: 20 });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Insert left' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    expect(insert).toHaveBeenLastCalledWith('name', 'left');
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    fireEvent.contextMenu(header, { clientX: 40, clientY: 20 });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Insert right' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    expect(insert).toHaveBeenLastCalledWith('name', 'right');
  });

  it('retains a failed draft and its original identity across refresh, then retries without duplicate writes', async () => {
    let settle!: (result: Result<void, DatabaseOpsError>) => void;
    const rename = vi
      .fn<
        (
          id: string,
          name: string,
          previousName: string
        ) => ResultAsync<void, DatabaseOpsError>
      >()
      .mockImplementationOnce(
        () =>
          new ResultAsync(
            new Promise((resolve) => {
              settle = resolve;
            })
          )
      )
      .mockReturnValue(okAsync(undefined));
    const [current, setCurrent] = createSignal(column);
    render(() => (
      <DatabaseColumnHeader
        column={current()}
        canRename
        onRename={rename}
        onSort={vi.fn()}
      />
    ));
    fireEvent.dblClick(screen.getByRole('columnheader', { name: 'Name' }));
    const input = (await screen.findByLabelText(
      'Column name'
    )) as HTMLInputElement;
    fireEvent.input(input, { target: { value: ' Task ' } });
    setCurrent({ ...column, name: 'Server label' });
    expect(input.value).toBe(' Task ');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(rename).toHaveBeenCalledExactlyOnceWith('name', 'Task', 'Name');
    expect(input.readOnly).toBe(true);
    expect(screen.getByLabelText('Column name')).toBe(input);
    settle(
      err({ code: 'NETWORK_ERROR', message: 'Connection lost', refusal: null })
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your change could not be sent. Check your connection.'
    );
    expect(input.value).toBe(' Task ');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByLabelText('Column name')).toBeNull()
    );
    expect(rename).toHaveBeenNthCalledWith(2, 'name', 'Task', 'Name');
  });

  it('supports F2, cancels with Escape, and ignores composing Enter', async () => {
    const rename = vi.fn(() => okAsync(undefined));
    render(() => (
      <DatabaseColumnHeader
        column={column}
        canRename
        onRename={rename}
        onSort={vi.fn()}
      />
    ));
    const header = screen.getByRole('columnheader', { name: 'Name' });
    fireEvent.keyDown(header, { key: 'F2' });
    const input = await screen.findByLabelText('Column name');
    fireEvent.input(input, { target: { value: '名前' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(rename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Column name')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(header));
  });

  it('saves on blur without taking focus back, and drops a name emptied before blurring', async () => {
    const rename = vi.fn(() => okAsync(undefined));
    render(() => (
      <>
        <DatabaseColumnHeader
          column={column}
          canRename
          onRename={rename}
          onSort={vi.fn()}
        />
        <button type="button">Elsewhere</button>
      </>
    ));
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    fireEvent.dblClick(screen.getByRole('columnheader', { name: 'Name' }));
    const input = await screen.findByLabelText('Column name');
    fireEvent.input(input, { target: { value: 'Title' } });
    elsewhere.focus();
    fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.queryByLabelText('Column name')).toBeNull()
    );
    expect(rename).toHaveBeenCalledExactlyOnceWith('name', 'Title', 'Name');
    expect(document.activeElement).toBe(elsewhere);

    fireEvent.dblClick(screen.getByRole('columnheader', { name: 'Name' }));
    const second = await screen.findByLabelText('Column name');
    fireEvent.input(second, { target: { value: '  ' } });
    fireEvent.blur(second);
    expect(screen.queryByLabelText('Column name')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rename).toHaveBeenCalledOnce();
  });

  it('keeps sort and view controls available without exposing rename to a viewer', async () => {
    const rename = vi.fn(() => okAsync(undefined));
    const sort = vi.fn();
    render(() => (
      <DatabaseColumnHeader
        column={column}
        canRename={false}
        onRename={rename}
        onSort={sort}
      />
    ));
    const header = screen.getByRole('columnheader', { name: 'Name' });
    fireEvent.dblClick(header);
    fireEvent.keyDown(header, { key: 'F2' });
    expect(screen.queryByLabelText('Column name')).toBeNull();
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(
      await screen.findByRole('menuitem', { name: 'Sort ascending' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'Rename column' })
    ).toBeNull();
    fireEvent(
      screen.getByRole('menuitem', { name: 'Sort ascending' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    expect(sort).toHaveBeenCalledExactlyOnceWith('name', 'asc');
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    expect(rename).not.toHaveBeenCalled();
  });
});

it('requires confirmation before deleting a column and retains a failed deletion', async () => {
  const remove = vi.fn(() =>
    errAsync<void, DatabaseOpsError>({
      code: 'CONFLICT',
      message: 'Version conflict',
      refusal: null,
    })
  );
  render(() => (
    <DatabaseColumnHeader
      column={column}
      canRename
      onRename={vi.fn(() => okAsync(undefined))}
      onSort={vi.fn()}
      onDelete={remove}
    />
  ));
  fireEvent.keyDown(screen.getByRole('columnheader', { name: 'Name' }), {
    key: 'Enter',
  });
  fireEvent(
    await screen.findByRole('menuitem', { name: 'Delete column' }),
    new MouseEvent('pointerup', { button: 0, bubbles: true })
  );
  expect(remove).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog')).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement?.textContent).toBe('Cancel')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
  await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('name'));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'This table changed.'
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('uses the type submenu and surfaces lossless conversion failures without changing the label', async () => {
  const changeType = vi.fn(() =>
    errAsync<void, DatabaseOpsError>({
      code: 'INVALID_OP',
      message: 'op 0: Some text cannot become a number without changing it.',
      refusal: {
        message: 'Some text cannot become a number without changing it.',
        op: 0,
        row: null,
        column: 'name',
        taken: null,
      },
    })
  );
  render(() => (
    <DatabaseColumnHeader
      column={column}
      canRename
      onRename={vi.fn(() => okAsync(undefined))}
      onSort={vi.fn()}
      onChangeType={changeType}
    />
  ));
  fireEvent.keyDown(screen.getByRole('columnheader', { name: 'Name' }), {
    key: 'Enter',
  });
  const submenu = await screen.findByRole('menuitem', { name: 'Change type' });
  submenu.focus();
  fireEvent.keyDown(submenu, { key: 'ArrowRight' });
  fireEvent(
    await screen.findByRole('menuitem', { name: 'Number' }),
    new MouseEvent('pointerup', { button: 0, bubbles: true })
  );
  await waitFor(() =>
    expect(changeType).toHaveBeenCalledExactlyOnceWith('name', {
      to: { type: 'number' },
      baseVersion: undefined,
    })
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Some text cannot become a number'
  );
  expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy();
});

describe('column header options', () => {
  it('closes the option editor with one Escape, then the options with the next', async () => {
    render(() => (
      <OptionEditingContext.Provider
        value={{
          update: vi.fn(() => okAsync(undefined)),
          remove: vi.fn(() => okAsync(undefined)),
        }}
      >
        <DatabaseColumnHeader
          column={{
            id: 'rsvp',
            name: 'RSVP',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [{ id: 'yes', label: 'Yes', color: null }],
            writable: true,
          }}
          canRename
          onRename={vi.fn(() => okAsync(undefined))}
          onSort={vi.fn()}
        />
      </OptionEditingContext.Provider>
    ));
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'RSVP' }), {
      clientX: 40,
      clientY: 20,
    });
    fireEvent(
      await screen.findByRole('menuitem', { name: 'Edit options' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Yes' }));
    const name = await screen.findByRole('textbox', { name: 'Option name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(screen.getByRole('dialog', { name: 'Options' })).toBeTruthy();

    fireEvent.keyDown(name, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Option name' })).toBeNull()
    );
    expect(screen.getByRole('dialog', { name: 'Options' })).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull()
    );
  });
});
