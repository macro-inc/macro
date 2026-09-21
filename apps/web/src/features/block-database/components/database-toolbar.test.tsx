import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type DatabaseViewConfig,
  defaultDatabaseView,
} from '../core/database-view';
import { DatabaseToolbar } from './database-toolbar';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
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

it('focuses each popover first control and returns to its trigger on Escape', async () => {
  render(() => (
    <DatabaseToolbar
      columns={[
        {
          id: 'name',
          name: 'Name',
          dataType: 'STRING',
          isMultiSelect: false,
          options: [],
          writable: true,
        },
      ]}
      value={defaultDatabaseView()}
      onChange={vi.fn()}
      savedViews={[]}
      onSelectView={vi.fn()}
      onSaveView={vi.fn(async () => {})}
      onRenameView={vi.fn(async () => {})}
      onDeleteView={vi.fn(async () => {})}
    />
  ));
  for (const [triggerName, firstControlName] of [
    ['Filter', 'Add condition'],
    ['Sort', 'Add sort'],
    ['View settings', 'Table'],
  ]) {
    const trigger = screen.getByRole('button', { name: triggerName });
    trigger.focus();
    fireEvent.click(trigger);
    const control = await screen.findByRole('button', {
      name: firstControlName,
    });
    await waitFor(() => expect(document.activeElement).toBe(control));
    fireEvent.keyDown(control, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  }
});

it('renames the exact inactive view from its context menu without changing selection', async () => {
  const [selected, setSelected] = createSignal('work');
  const [views, setViews] = createSignal([
    { id: 'work', name: 'My work', view: defaultDatabaseView() },
    { id: 'next', name: 'Next week', view: defaultDatabaseView() },
    { id: 'done', name: 'Done', view: defaultDatabaseView() },
  ]);
  const rename = vi.fn(async () => {});
  const select = vi.fn();
  render(() => (
    <DatabaseToolbar
      columns={[]}
      value={defaultDatabaseView()}
      onChange={vi.fn()}
      savedViews={views()}
      selectedViewId={selected()}
      onSelectView={select}
      onSaveView={vi.fn(async () => {})}
      onRenameView={rename}
      onDeleteView={vi.fn(async () => {})}
    />
  ));
  const tab = screen.getByRole('button', { name: 'Next week' });
  fireEvent.contextMenu(tab, { clientX: 100, clientY: 40 });
  fireEvent(
    await screen.findByRole('menuitem', { name: /Rename view/ }),
    new MouseEvent('pointerup', { button: 0, bubbles: true })
  );
  const name = await screen.findByLabelText('View name');
  await waitFor(() =>
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
  );
  await waitFor(() => expect(document.activeElement).toBe(name));
  expect((name as HTMLInputElement).value).toBe('Next week');
  expect((name as HTMLInputElement).selectionStart).toBe(0);
  expect((name as HTMLInputElement).selectionEnd).toBe('Next week'.length);
  expect(select).not.toHaveBeenCalled();
  fireEvent.input(name, { target: { value: 'Soon' } });
  setSelected('done');
  setViews((current) =>
    current.map((view) => ({ ...view, name: `${view.name} updated` }))
  );
  expect((name as HTMLInputElement).value).toBe('Soon');
  fireEvent.submit(name.closest('form')!);
  await waitFor(() =>
    expect(rename).toHaveBeenCalledExactlyOnceWith('next', 'Soon')
  );
  await waitFor(() => expect(document.activeElement).toBe(tab));
});

it('keeps delete confirmation bound to its context-menu view after selection changes', async () => {
  const [selected, setSelected] = createSignal('work');
  const [views, setViews] = createSignal([
    { id: 'work', name: 'My work', view: defaultDatabaseView() },
    { id: 'next', name: 'Next week', view: defaultDatabaseView() },
    { id: 'done', name: 'Done', view: defaultDatabaseView() },
  ]);
  const remove = vi.fn(async (id: string) => {
    setViews((current) => current.filter((view) => view.id !== id));
  });
  render(() => (
    <DatabaseToolbar
      columns={[]}
      value={defaultDatabaseView()}
      onChange={vi.fn()}
      savedViews={views()}
      selectedViewId={selected()}
      onSelectView={setSelected}
      onSaveView={vi.fn(async () => {})}
      onRenameView={vi.fn(async () => {})}
      onDeleteView={remove}
    />
  ));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Next week' }));
  fireEvent(
    await screen.findByRole('menuitem', { name: 'Delete view' }),
    new MouseEvent('pointerup', { button: 0, bubbles: true })
  );
  await screen.findByRole('dialog', { name: 'Delete saved view?' });
  await waitFor(() =>
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
  );
  setSelected('done');
  expect(screen.getByText(/“Next week” will be removed/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
  await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('next'));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'All records' })
    )
  );
});

it('supports inactive view double click, F2, and keyboard context menus across refreshed tabs', async () => {
  const [selected, setSelected] = createSignal('work');
  const [views, setViews] = createSignal([
    { id: 'work', name: 'My work', view: defaultDatabaseView() },
    { id: 'next', name: 'Next week', view: defaultDatabaseView() },
  ]);
  render(() => (
    <DatabaseToolbar
      columns={[]}
      value={defaultDatabaseView()}
      onChange={vi.fn()}
      savedViews={views()}
      selectedViewId={selected()}
      onSelectView={(id) => {
        setSelected(id ?? '');
        setViews((current) => current.map((view) => ({ ...view })));
      }}
      onSaveView={vi.fn(async () => {})}
      onRenameView={vi.fn(async () => {})}
      onDeleteView={vi.fn(async () => {})}
    />
  ));
  const tab = screen.getByRole('button', { name: 'Next week' });
  fireEvent.click(tab, { detail: 1 });
  expect(screen.getByRole('button', { name: 'Next week' })).toBe(tab);
  fireEvent.click(tab, { detail: 2 });
  fireEvent.dblClick(tab);
  expect(
    ((await screen.findByLabelText('View name')) as HTMLInputElement).value
  ).toBe('Next week');
  fireEvent.keyDown(screen.getByLabelText('View name'), { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(tab));
  fireEvent.keyDown(tab, { key: 'F2' });
  await screen.findByRole('textbox', { name: 'View name' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(screen.getByLabelText('View name'), { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(tab));
  fireEvent.keyDown(tab, { key: 'ContextMenu' });
  expect(
    await screen.findByRole('menuitem', { name: /Rename view/ })
  ).toBeTruthy();
  expect(
    screen.getByRole('menuitem', { name: 'Save as new view' })
  ).toBeTruthy();
});

it('reveals a restored or newly selected saved view and keeps it visible as the rail narrows', async () => {
  const resizeCallbacks = new Map<Element, () => void>();
  class ResizeObserverMock {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      resizeCallbacks.set(target, () =>
        this.callback(
          [
            {
              target,
              contentRect: target.getBoundingClientRect(),
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        )
      );
    }
    unobserve(target: Element) {
      resizeCallbacks.delete(target);
    }
    disconnect() {
      resizeCallbacks.clear();
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  const [views, setViews] = createSignal([
    { id: 'work', name: 'My work', view: defaultDatabaseView() },
  ]);
  const [selected, setSelected] = createSignal<string | undefined>('work');
  render(() => (
    <DatabaseToolbar
      columns={[]}
      value={defaultDatabaseView()}
      onChange={vi.fn()}
      savedViews={views()}
      selectedViewId={selected()}
      onSelectView={setSelected}
      onSaveView={vi.fn(async () => {})}
      onRenameView={vi.fn(async () => {})}
      onDeleteView={vi.fn(async () => {})}
    />
  ));
  const rail = screen.getByLabelText('Saved views');
  let width = 100;
  vi.spyOn(rail, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 32)
  );
  const position = (name: string, left: number) => {
    const tab = screen.getByRole('button', { name });
    vi.spyOn(tab, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(left - rail.scrollLeft, 0, 70, 32)
    );
    return tab;
  };
  const all = position('All records', 0);
  position('My work', 120);
  await waitFor(() => expect(rail.scrollLeft).toBe(90));
  fireEvent.click(all);
  await waitFor(() => expect(rail.scrollLeft).toBe(0));
  setViews((current) => [
    ...current,
    { id: 'next', name: 'Next week', view: defaultDatabaseView() },
  ]);
  position('Next week', 240);
  setSelected('next');
  await waitFor(() => expect(rail.scrollLeft).toBe(210));
  width = 80;
  resizeCallbacks.get(rail)?.();
  expect(rail.scrollLeft).toBe(230);
  expect(rail.style.getPropertyValue('--view-rail-width')).toBe('80px');
  expect(screen.getByRole('button', { name: 'New view' })).toBeTruthy();
});

it('groups layout, board grouping, and column visibility in one view settings control', async () => {
  const initial = defaultDatabaseView();
  const [view, setView] = createSignal(initial);
  const create = vi.fn();
  const save = vi.fn(async () => {});
  render(() => (
    <DatabaseToolbar
      columns={[
        {
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: ['Done'],
          writable: true,
        },
      ]}
      value={view()}
      onChange={setView}
      selectedViewId="work"
      savedViews={[{ id: 'work', name: 'My work', view: initial }]}
      onSelectView={vi.fn()}
      onSaveView={save}
      onUpdateView={save}
      onRenameView={save}
      onDeleteView={save}
      addColumn={<button type="button">Add column</button>}
      onCreateRecord={create}
      canCreateRecord
    />
  ));
  expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull()
  );
  fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
  expect(
    await screen.findByRole('button', { name: 'Add column' })
  ).toBeTruthy();
  const visible = screen.getByRole('checkbox', { name: 'Status' });
  fireEvent.click(visible);
  expect(view().hiddenColumns).toEqual(['status']);
  fireEvent.click(screen.getByRole('button', { name: 'Show all columns' }));
  expect(view().hiddenColumns).toEqual([]);
  fireEvent.click(await screen.findByRole('button', { name: 'Board' }));
  expect(view().layout).toBe('board');
  expect(view().groupBy).toBe('status');
  expect(
    screen.getByRole('button', { name: 'My work' }).getAttribute('aria-pressed')
  ).toBe('true');
  expect(screen.getByRole('button', { name: /^Group board by/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close view settings' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull()
  );
  fireEvent.click(screen.getByRole('button', { name: 'New record' }));
  expect(create).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it('expands search inline, keeps focus while clearing, and closes with Escape without changing filters', async () => {
  const filter = {
    id: 'name',
    columnId: 'name',
    operator: 'contains' as const,
    value: 'Plan',
  };
  const [view, setView] = createSignal<DatabaseViewConfig>({
    ...defaultDatabaseView(),
    filters: [filter],
  });
  render(() => (
    <DatabaseToolbar
      columns={[
        {
          id: 'name',
          name: 'Name',
          dataType: 'STRING',
          isMultiSelect: false,
          options: [],
          writable: true,
        },
      ]}
      value={view()}
      onChange={setView}
      savedViews={[]}
      onSelectView={vi.fn()}
      onSaveView={vi.fn(async () => {})}
      onRenameView={vi.fn(async () => {})}
      onDeleteView={vi.fn(async () => {})}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const input = await screen.findByRole('searchbox', {
    name: 'Search records',
  });
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.closest('[data-database-toolbar]')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.input(input, { target: { value: 'launch' } });
  expect(view().search).toBe('launch');
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(view().search).toBe('');
  expect(view().filters).toEqual([filter]);
  expect(document.activeElement).toBe(input);
  fireEvent.input(input, { target: { value: 'second search' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Search' })
    )
  );
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(view().search).toBe('');
  expect(view().filters).toEqual([filter]);
});

it('clears Save changes after the server returns filter keys in a different order', async () => {
  const initial: DatabaseViewConfig = {
    ...defaultDatabaseView(),
    filters: [
      { id: 'filter', columnId: 'status', operator: 'equals', value: 'Done' },
    ],
  };
  const [draft, setDraft] = createSignal(initial);
  const [saved, setSaved] = createSignal(initial);
  const save = vi.fn(async () => {
    setSaved({
      ...draft(),
      filters: draft().filters.map(({ id, columnId, operator, value }) => ({
        value,
        operator,
        columnId,
        id,
      })),
    });
  });
  render(() => (
    <DatabaseToolbar
      columns={[
        {
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: ['Done', 'In progress'],
          writable: true,
        },
      ]}
      value={draft()}
      onChange={setDraft}
      selectedViewId="view"
      savedViews={[{ id: 'view', name: 'My work', view: saved() }]}
      onSelectView={vi.fn()}
      onSaveView={vi.fn(async () => {})}
      onUpdateView={save}
      onRenameView={vi.fn(async () => {})}
      onDeleteView={vi.fn(async () => {})}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filter 1' }));
  fireEvent.keyDown(
    await screen.findByRole('button', { name: /^Filter value/ }),
    { key: 'Enter' }
  );
  fireEvent.keyDown(
    await screen.findByRole('option', { name: 'In progress' }),
    { key: 'Enter' }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  );
  expect(saved().filters[0].value).toBe('In progress');
});
