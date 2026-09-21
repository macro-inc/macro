import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTable } from '../core/table-creation';
import { TableNavigation } from './table-navigation';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  resize(target: Element) {
    const contentRect = target.getBoundingClientRect();
    const size = {
      inlineSize: contentRect.width,
      blockSize: contentRect.height,
    };
    this.callback(
      [
        {
          target,
          contentRect,
          borderBoxSize: [size],
          contentBoxSize: [size],
          devicePixelContentBoxSize: [size],
        },
      ],
      this
    );
  }
}
let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  ResizeObserverMock.instances = [];
  // JSDOM reports an empty animation name; presence expects CSS's default none.
  menuStyles = document.createElement('style');
  menuStyles.textContent = '[role=menu] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function navigation(onCreate: CreateTable, onSelect = vi.fn()) {
  render(() => (
    <TableNavigation
      tables={[{ id: 'tasks', name: 'Tasks' }]}
      activeTableId="tasks"
      canCreate
      onCreate={onCreate}
      onSelect={onSelect}
    />
  ));
  return onSelect;
}

describe('table creation and navigation', () => {
  it('renames an inactive tab by double click even when the first click refreshes table objects', async () => {
    const [tables, setTables] = createSignal([
      { id: 'tasks', name: 'Tasks' },
      { id: 'people', name: 'People' },
    ]);
    const [active, setActive] = createSignal('tasks');
    const rename = vi.fn(async () => {});
    render(() => (
      <TableNavigation
        tables={tables()}
        activeTableId={active()}
        canCreate
        onCreate={vi.fn<CreateTable>()}
        onSelect={(id) => {
          setActive(id);
          setTables((current) => current.map((table) => ({ ...table })));
        }}
        onRename={rename}
      />
    ));
    const tab = screen.getByRole('tab', { name: 'People' });
    fireEvent.click(tab, { detail: 1 });
    expect(screen.getByRole('tab', { name: 'People' })).toBe(tab);
    fireEvent.click(tab, { detail: 2 });
    fireEvent.dblClick(tab);
    const name = await screen.findByLabelText('Table name');
    expect((name as HTMLInputElement).value).toBe('People');
    fireEvent.input(name, { target: { value: 'Members' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(name.closest('[role=tablist]')).toBeTruthy();
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() =>
      expect(rename).toHaveBeenCalledExactlyOnceWith(
        'people',
        'Members',
        'People'
      )
    );
  });

  it('opens the targeted table menu without selecting it and restores focus after rename cancellation', async () => {
    const select = vi.fn();
    render(() => (
      <TableNavigation
        tables={[
          { id: 'tasks', name: 'Tasks' },
          { id: 'people', name: 'People' },
        ]}
        activeTableId="tasks"
        canCreate
        onCreate={vi.fn<CreateTable>()}
        onSelect={select}
        onRename={vi.fn(async () => {})}
      />
    ));
    const tab = screen.getByRole('tab', { name: 'People' });
    fireEvent.contextMenu(tab, { clientX: 100, clientY: 40 });
    fireEvent(
      await screen.findByRole('menuitem', { name: /Rename table/ }),
      new MouseEvent('pointerup', { button: 0, bubbles: true })
    );
    const name = await screen.findByLabelText('Table name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    expect((name as HTMLInputElement).value).toBe('People');
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(name, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(tab));
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
  });

  it('supports keyboard context menus and F2 on the focused table', async () => {
    render(() => (
      <TableNavigation
        tables={[{ id: 'tasks', name: 'Tasks' }]}
        activeTableId="tasks"
        canCreate
        onCreate={vi.fn<CreateTable>()}
        onSelect={vi.fn()}
        onRename={vi.fn(async () => {})}
      />
    ));
    const tab = screen.getByRole('tab', { name: 'Tasks' });
    tab.focus();
    fireEvent.keyDown(tab, { key: 'F10', shiftKey: true });
    const rename = await screen.findByRole('menuitem', {
      name: /Rename table/,
    });
    fireEvent.keyDown(rename, { key: 'Enter' });
    const name = await screen.findByLabelText('Table name');
    fireEvent.keyDown(name, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(tab));
    fireEvent.keyDown(tab, { key: 'F2' });
    expect(await screen.findByLabelText('Table name')).toBeTruthy();
  });

  it('saves a renamed table on blur without taking focus back', async () => {
    const rename = vi.fn(async () => {});
    render(() => (
      <>
        <TableNavigation
          tables={[{ id: 'tasks', name: 'Tasks' }]}
          activeTableId="tasks"
          canCreate
          onCreate={vi.fn<CreateTable>()}
          onSelect={vi.fn()}
          onRename={rename}
        />
        <button type="button">Next control</button>
      </>
    ));
    fireEvent.dblClick(screen.getByRole('tab', { name: 'Tasks' }));
    const name = await screen.findByLabelText('Table name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect((name as HTMLInputElement).selectionStart).toBe(0);
    expect((name as HTMLInputElement).selectionEnd).toBe('Tasks'.length);
    fireEvent.input(name, { target: { value: 'Projects' } });
    expect(fireEvent.keyDown(name, { key: 'Tab' })).toBe(true);
    const next = screen.getByRole('button', { name: 'Next control' });
    next.focus();
    await waitFor(() =>
      expect(rename).toHaveBeenCalledExactlyOnceWith(
        'tasks',
        'Projects',
        'Tasks'
      )
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Table name')).toBeNull()
    );
    expect(document.activeElement).toBe(next);
    expect(screen.queryByRole('button', { name: /Rename table/ })).toBeNull();
  });

  it('keeps a failed rename draft for retry through refreshed table data', async () => {
    const [tables, setTables] = createSignal([
      { id: 'tasks', name: 'Tasks' },
      { id: 'people', name: 'People' },
    ]);
    const rename = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(undefined);
    render(() => (
      <TableNavigation
        tables={tables()}
        activeTableId="tasks"
        canCreate
        onCreate={vi.fn<CreateTable>()}
        onSelect={vi.fn()}
        onRename={rename}
      />
    ));
    const tab = screen.getByRole('tab', { name: 'People' });
    fireEvent.dblClick(tab);
    const name = await screen.findByLabelText('Table name');
    fireEvent.input(name, { target: { value: 'Team' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Offline');
    setTables((current) => current.map((table) => ({ ...table })));
    expect(screen.getByLabelText('Table name')).toBe(name);
    expect((name as HTMLInputElement).value).toBe('Team');
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByLabelText('Table name')).toBeNull()
    );
    expect(rename).toHaveBeenNthCalledWith(2, 'people', 'Team', 'People');
    await waitFor(() => expect(document.activeElement).toBe(tab));
  });

  it('rejects duplicate names and lets Escape discard the inline draft', async () => {
    const rename = vi.fn(async () => {});
    render(() => (
      <TableNavigation
        tables={[
          { id: 'tasks', name: 'Tasks' },
          { id: 'people', name: 'People' },
        ]}
        activeTableId="tasks"
        canCreate
        onCreate={vi.fn<CreateTable>()}
        onSelect={vi.fn()}
        onRename={rename}
      />
    ));
    const tab = screen.getByRole('tab', { name: 'Tasks' });
    fireEvent.keyDown(tab, { key: 'F2' });
    const name = await screen.findByLabelText('Table name');
    fireEvent.input(name, { target: { value: ' people ' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'A table with this name already exists.'
    );
    expect(rename).not.toHaveBeenCalled();
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(screen.queryByLabelText('Table name')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tab));
    expect(rename).not.toHaveBeenCalled();
  });

  it('keeps restored, selected, and newly created tabs visible when the rail narrows', async () => {
    const [tables, setTables] = createSignal([
      { id: 'people', name: 'People' },
      { id: 'tasks', name: 'Tasks' },
    ]);
    const [active, setActive] = createSignal('tasks');
    render(() => (
      <TableNavigation
        tables={tables()}
        activeTableId={active()}
        canCreate
        onCreate={vi.fn<CreateTable>()}
        onSelect={setActive}
      />
    ));
    const rail = screen.getByRole('tablist', { name: 'Database tables' });
    let width = 100;
    vi.spyOn(rail, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, width, 36)
    );
    const positionTab = (name: string, left: number) => {
      const tab = screen.getByRole('tab', { name });
      vi.spyOn(tab, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(left - rail.scrollLeft, 0, 70, 32)
      );
      return tab;
    };
    const people = positionTab('People', 0);
    positionTab('Tasks', 120);
    await waitFor(() => expect(rail.scrollLeft).toBe(90));

    fireEvent.click(people);
    await waitFor(() => expect(rail.scrollLeft).toBe(0));
    setTables((current) => [...current, { id: 'projects', name: 'Projects' }]);
    await screen.findByRole('tab', { name: 'Projects' });
    positionTab('Projects', 240);
    setActive('projects');
    await waitFor(() => expect(rail.scrollLeft).toBe(210));

    width = 80;
    const observer = ResizeObserverMock.instances.find((entry) =>
      entry.targets.has(rail)
    );
    expect(observer).toBeDefined();
    observer!.resize(rail);
    expect(rail.scrollLeft).toBe(230);
    expect(screen.getByRole('button', { name: 'New table' })).toBeTruthy();
  });

  it('focuses the name, validates duplicates, creates the named table and opens it', async () => {
    const create = vi.fn<CreateTable>(async () => ({
      tableId: 'projects',
      ready: true,
    }));
    const select = navigation(create);
    expect(
      screen.getByRole('tab', { name: 'Tasks' }).getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'New table' }));
    const name = await screen.findByLabelText('Table name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.input(name, { target: { value: ' tasks ' } });
    fireEvent.submit(name.closest('form')!);
    expect(create).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'A table with this name already exists. Try another name.'
      )
    ).toBeTruthy();
    fireEvent.input(name, { target: { value: ' Projects ' } });
    fireEvent.submit(name.closest('form')!);
    await waitFor(() => expect(select).toHaveBeenCalledWith('projects'));
    expect(create).toHaveBeenCalledWith('Projects', undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the draft after a failed create and prevents double submission', async () => {
    let reject: (error: Error) => void = () => {};
    const create = vi.fn<CreateTable>(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    navigation(create);
    fireEvent.click(screen.getByRole('button', { name: 'New table' }));
    const name = await screen.findByLabelText('Table name');
    fireEvent.input(name, { target: { value: 'Projects' } });
    fireEvent.submit(name.closest('form')!);
    fireEvent.submit(name.closest('form')!);
    expect(create).toHaveBeenCalledTimes(1);
    reject(new Error('Offline'));
    await screen.findByRole('alert');
    expect((name as HTMLInputElement).value).toBe('Projects');
    expect((name as HTMLInputElement).readOnly).toBe(false);
  });

  it('resumes setup for the already-created table instead of creating another', async () => {
    const create = vi
      .fn<CreateTable>()
      .mockResolvedValueOnce({
        tableId: 'projects',
        ready: false,
        message: 'Your table was created. Retry setup.',
      })
      .mockResolvedValueOnce({ tableId: 'projects', ready: true });
    const select = navigation(create);
    fireEvent.click(screen.getByRole('button', { name: 'New table' }));
    const name = await screen.findByLabelText('Table name');
    fireEvent.input(name, { target: { value: 'Projects' } });
    fireEvent.submit(name.closest('form')!);
    await screen.findByRole('alert');
    expect((name as HTMLInputElement).readOnly).toBe(true);
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    await waitFor(() => expect(select).toHaveBeenCalledWith('projects'));
    expect(create).toHaveBeenLastCalledWith('Projects', 'projects');
  });

  it('restores focus on cancel and focuses the name when reopening', async () => {
    navigation(vi.fn<CreateTable>());
    const trigger = screen.getByRole('button', { name: 'New table' });
    fireEvent.click(trigger);
    await screen.findByLabelText('Table name');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    const name = await screen.findByLabelText('Table name');
    await waitFor(() => expect(document.activeElement).toBe(name));
  });
});
