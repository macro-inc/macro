import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { DatabaseBoard } from './database-board';

const columns: DatabaseViewColumn[] = [
  {
    id: 'title',
    name: 'Name',
    dataType: 'STRING',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'status',
    name: 'Status',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: ['To do', 'Done'],
    writable: true,
  },
];
const initialRows: DatabaseRow[] = [
  { rowId: 'launch', cells: { title: 'Launch project', status: 'To do' } },
  { rowId: 'unassigned', cells: { title: 'Unassigned record', status: null } },
];

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('database board', () => {
  it('orders visible metadata without changing the record title or showing hidden fields', () => {
    const details = [
      { ...columns[0], id: 'owner', name: 'Owner' },
      { ...columns[0], id: 'team', name: 'Team' },
      { ...columns[0], id: 'notes', name: 'Notes' },
    ];
    render(() => (
      <DatabaseBoard
        rows={[
          {
            ...initialRows[0],
            cells: {
              ...initialRows[0].cells,
              owner: 'Ada',
              team: 'Design',
              notes: 'Bring draft',
            },
          },
        ]}
        columns={[...columns, ...details]}
        visibleColumnIds={['notes', 'title', 'owner']}
        groupColumn={columns[1]}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn(async () => true)}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const card = screen.getByRole('button', { name: 'Open Launch project' });
    expect(within(card).getByText('Launch project')).toBeTruthy();
    expect(within(card).queryByText('Design')).toBeNull();
    expect(
      Array.from(card.querySelectorAll('[title]'), (element) =>
        element.getAttribute('title')
      )
    ).toEqual(['Notes: Bring draft', 'Owner: Ada']);
  });

  it('keeps a failed new-group draft and lets the user retry it', async () => {
    const onAddGroup = vi.fn(async (_label: string) => {});
    onAddGroup.mockRejectedValueOnce(new Error('Connection unavailable'));
    render(() => (
      <DatabaseBoard
        rows={initialRows}
        columns={columns}
        groupColumn={columns[1]}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn(async () => true)}
        onCreate={vi.fn(async () => true)}
        onAddGroup={onAddGroup}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    const input = screen.getByRole('textbox', {
      name: 'New group name',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'In review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Connection unavailable'
      )
    );
    expect(input.value).toBe('In review');
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() => expect(onAddGroup).toHaveBeenCalledTimes(2));
    expect(onAddGroup).toHaveBeenLastCalledWith('In review');
  });

  it('validates numeric groups and sends their canonical SQL labels', async () => {
    const onAddGroup = vi.fn(async (_label: string) => {});
    const groupColumn = {
      ...columns[1],
      dataType: 'SELECT_NUMBER',
      options: ['2'],
    };
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[columns[0], groupColumn]}
        groupColumn={groupColumn}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn(async () => true)}
        onCreate={vi.fn(async () => true)}
        onAddGroup={onAddGroup}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: 'not a number' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByRole('alert').textContent).toContain('valid number');
    expect(onAddGroup).not.toHaveBeenCalled();
    fireEvent.input(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: '1.0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() => expect(onAddGroup).toHaveBeenCalledWith('1'));
  });

  it('drags the entire card at its original size without opening the record on drop', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const label = this.getAttribute('aria-label');
        const x =
          label === 'Done lane' ? 300 : label?.startsWith('No ') ? 600 : 0;
        const isCard = this.hasAttribute('data-row-id');
        return new DOMRect(
          x,
          isCard ? 60 : 0,
          isCard ? 250 : 280,
          isCard ? 100 : 500
        );
      }
    );
    const onMove = vi.fn(async () => true);
    const onOpen = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={initialRows}
        columns={columns}
        groupColumn={columns[1]}
        canEdit
        rowPending={() => false}
        onOpen={onOpen}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Launch project' }),
      { button: 0, clientX: 200, clientY: 80 }
    );
    fireEvent.mouseMove(document, { clientX: 510, clientY: 100 });
    const preview = document.querySelector<HTMLElement>(
      '[data-kanban-preview]'
    )!;
    expect(preview.style.width).toBe('250px');
    expect(preview.style.height).toBe('100px');
    expect(preview.style.transform).toBe('none');
    fireEvent.mouseUp(document, { button: 0, clientX: 510, clientY: 100 });
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Launch project' })
    );
    expect(onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('launch', 'Done'));
  });

  it('renders empty configured groups and a group for unassigned records', () => {
    render(() => (
      <DatabaseBoard
        rows={initialRows}
        columns={columns}
        groupColumn={columns[1]}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn(async () => true)}
        onCreate={vi.fn(async () => true)}
      />
    ));
    expect(screen.getByRole('region', { name: 'Done lane' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open Unassigned record' })
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New record' })).toHaveLength(
      3
    );
  });

  it('offers an accessible move menu that writes the target value', async () => {
    const onMove = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={initialRows}
        columns={columns}
        groupColumn={columns[1]}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Move Launch project' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const done = await screen.findByRole('menuitem', { name: 'Done' });
    fireEvent.keyDown(done, { key: 'Enter' });
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('launch', 'Done'));
  });

  it('keeps a new-card title after a failed write and unrelated row updates', async () => {
    const [rows, setRows] = createSignal(initialRows);
    const onCreate = vi.fn(async () => false);
    render(() => (
      <DatabaseBoard
        rows={rows()}
        columns={columns}
        groupColumn={columns[1]}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn(async () => true)}
        onCreate={onCreate}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Done' }));
    const input = screen.getByRole('textbox', {
      name: 'New record title',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Remember this draft' } });
    setRows([
      ...initialRows,
      { rowId: 'other', cells: { title: 'Other record', status: 'Done' } },
    ]);
    expect(
      (
        screen.getByRole('textbox', {
          name: 'New record title',
        }) as HTMLInputElement
      ).value
    ).toBe('Remember this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        'Done',
        'Remember this draft',
        expect.any(String)
      )
    );
    expect(
      (
        (await screen.findByRole('textbox', {
          name: 'New record title',
        })) as HTMLInputElement
      ).value
    ).toBe('Remember this draft');
  });

  it('opens records for viewers without exposing move or create actions', () => {
    const onOpen = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={initialRows}
        columns={columns}
        groupColumn={columns[1]}
        canEdit={false}
        rowPending={() => false}
        onOpen={onOpen}
        onMove={vi.fn(async () => true)}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Launch project' })
    );
    expect(onOpen).toHaveBeenCalledWith('launch');
    expect(
      screen.queryByRole('button', { name: 'Move Launch project' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Done lane' })).getByText(
        'No records'
      )
    ).toBeTruthy();
  });
});

it('shows submitted cards immediately and allows the next draft while the first save is pending', async () => {
  const [pending, setPending] = createSignal(new Set<string>());
  let complete: (saved: boolean) => void = () => {};
  const onCreate = vi.fn((_value: unknown, _title: string, intent: string) => {
    setPending((ids) => new Set(ids).add(intent));
    return new Promise<boolean>((resolve) => {
      complete = (saved) => {
        setPending((ids) => new Set([...ids].filter((id) => id !== intent)));
        resolve(saved);
      };
    });
  });
  render(() => (
    <DatabaseBoard
      rows={[]}
      columns={columns}
      groupColumn={columns[1]}
      canEdit
      rowPending={() => false}
      createPending={(id) => pending().has(id)}
      onOpen={vi.fn()}
      onMove={vi.fn(async () => true)}
      onCreate={onCreate}
    />
  ));
  const lane = screen.getByRole('region', { name: 'Done lane' });
  fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
  const input = screen.getByRole('textbox', { name: 'New record title' });
  fireEvent.input(input, { target: { value: 'First idea' } });
  fireEvent.submit(input.closest('form')!);
  expect(
    within(lane).getByRole('status', { name: 'Saving new record' }).textContent
  ).toContain('First idea');
  fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
  expect(
    screen.getByRole('textbox', { name: 'New record title' })
  ).toBeTruthy();
  expect(onCreate).toHaveBeenCalledOnce();
  complete(false);
  await waitFor(() =>
    expect(
      screen.getAllByRole('textbox', { name: 'New record title' })
    ).toHaveLength(2)
  );
  expect(
    (
      screen.getAllByRole('textbox', {
        name: 'New record title',
      })[0] as HTMLInputElement
    ).value
  ).toBe('First idea');
});

it('reorders lanes with the keyboard while leaving every card value unchanged', () => {
  const [order, setOrder] = createSignal<string[]>();
  const move = vi.fn(async () => true);
  render(() => (
    <DatabaseBoard
      rows={initialRows}
      columns={columns}
      groupColumn={columns[1]}
      groupOrder={order()}
      onGroupOrderChange={setOrder}
      canEdit
      rowPending={() => false}
      onOpen={vi.fn()}
      onMove={move}
      onCreate={vi.fn(async () => true)}
    />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Done lane' }), {
    key: 'ArrowRight',
    altKey: true,
  });
  expect(
    [...document.querySelectorAll('[data-kanban-lane]')].map((lane) =>
      lane.getAttribute('aria-label')
    )
  ).toEqual(['To do lane', 'Done lane', 'No status lane']);
  expect(move).not.toHaveBeenCalled();
});
