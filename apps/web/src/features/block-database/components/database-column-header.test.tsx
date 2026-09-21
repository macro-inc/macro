import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  menuStyles.textContent = '[role=menu] { animation-name: none; }';
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
        onRename={vi.fn(async () => {})}
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

  it('retains a failed draft and its original identity across refresh, then retries without duplicate writes', async () => {
    let reject!: (error: Error) => void;
    const rename = vi
      .fn<(id: string, name: string, previousName: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          })
      )
      .mockResolvedValue(undefined);
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
    reject(new Error('Connection lost'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Connection lost'
    );
    expect(input.value).toBe(' Task ');
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry rename column' })
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Column name')).toBeNull()
    );
    expect(rename).toHaveBeenNthCalledWith(2, 'name', 'Task', 'Name');
  });

  it('supports F2, cancels with Escape, and ignores composing Enter', async () => {
    const rename = vi.fn(async () => {});
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

  it('keeps sort and view controls available without exposing rename to a viewer', async () => {
    const rename = vi.fn(async () => {});
    const hide = vi.fn();
    render(() => (
      <DatabaseColumnHeader
        column={column}
        canRename={false}
        onRename={rename}
        onSort={vi.fn()}
        onHide={hide}
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
      screen.getByRole('menuitem', { name: 'Hide column' }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    expect(hide).toHaveBeenCalledExactlyOnceWith('name');
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    expect(rename).not.toHaveBeenCalled();
  });
});

it('requires confirmation before deleting a column and retains a failed deletion', async () => {
  const remove = vi.fn(async () => {
    throw new Error('This table changed. Refresh and try again.');
  });
  render(() => (
    <DatabaseColumnHeader
      column={column}
      canRename
      onRename={vi.fn()}
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
  const changeType = vi.fn(async () => {
    throw new Error('Some text cannot become a number without changing it.');
  });
  render(() => (
    <DatabaseColumnHeader
      column={column}
      canRename
      onRename={vi.fn()}
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
      dataType: 'NUMBER',
    })
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Some text cannot become a number'
  );
  expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy();
});
