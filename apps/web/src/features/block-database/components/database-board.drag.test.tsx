import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DatabaseViewColumn,
  placeDatabaseCard,
} from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { DatabaseBoard, type DatabaseCardPlacement } from './database-board';

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
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: ['Done', 'To do'],
    writable: true,
  },
];
const initial: DatabaseRow[] = [
  { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
  { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
  { rowId: 'last', cells: { name: 'Last card', stage: 'Done' } },
];

let scrollOffset = 0;
let laneHeight = 500;

beforeEach(() => {
  scrollOffset = 0;
  laneHeight = 500;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('overflow-auto'))
        return new DOMRect(0, 0, 880, 500);
      const lane = this.closest('[data-kanban-lane]');
      const label = lane?.getAttribute('aria-label');
      const x =
        (label === 'To do lane' ? 300 : label === 'No stage lane' ? 600 : 0) -
        scrollOffset;
      const cardIndex = lane
        ? Array.from(lane.querySelectorAll('[data-kanban-card]')).indexOf(this)
        : 0;
      return this.hasAttribute('data-row-id')
        ? new DOMRect(x + 8, 60 + Math.max(0, cardIndex) * 100, 264, 80)
        : new DOMRect(x, 0, 280, laneHeight);
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function board(projected?: DatabaseRow[], pending = false) {
  const [rows, setRows] = createSignal(initial);
  const [order, setOrder] = createSignal<string[]>();
  const [cardOrder, setCardOrder] = createSignal<Record<string, string[]>>({});
  const onMove = vi.fn(async (rowId: string, value: unknown) => {
    setRows(
      projected ??
        rows().map((row) =>
          row.rowId === rowId
            ? { ...row, cells: { ...row.cells, stage: value as string } }
            : row
        )
    );
    return true;
  });
  const onOpen = vi.fn();
  const onOrder = vi.fn(setOrder);
  const onPlace = vi.fn(async (placement: DatabaseCardPlacement) => {
    const lane = Array.from(
      document.querySelectorAll<HTMLElement>('[data-kanban-lane]')
    ).find((lane) => lane.dataset.kanbanLane === placement.toLane)!;
    const visible = Array.from(
      lane.querySelectorAll<HTMLElement>('[data-kanban-card]')
    ).map((card) => card.dataset.kanbanCard!);
    setCardOrder((current) => ({
      ...current,
      [placement.toLane]: placeDatabaseCard(
        current[placement.toLane] ?? visible,
        visible,
        placement.rowId,
        placement.beforeId
      ),
    }));
    return onMove(placement.rowId, placement.value);
  });
  render(() => (
    <DatabaseBoard
      rows={rows()}
      columns={columns}
      groupColumn={columns[1]}
      groupOrder={order()}
      cardOrder={cardOrder()}
      onGroupOrderChange={onOrder}
      canEdit
      rowPending={() => pending}
      onOpen={onOpen}
      onMove={onMove}
      onPlace={onPlace}
      projectMove={projected ? () => projected : undefined}
      onCreate={vi.fn(async () => true)}
    />
  ));
  return { onMove, onOpen, onOrder, onPlace };
}

const marker = () =>
  document.querySelector<HTMLElement>('[data-kanban-insertion]');
const movePointer = (x: number, y = 90) =>
  fireEvent.mouseMove(document, { clientX: x, clientY: y });
const dropPointer = (x: number, y = 90) =>
  fireEvent.mouseUp(document, { button: 0, clientX: x, clientY: y });

describe('board drop placement', () => {
  it('places a card at the pointer gap instead of its previous source order', async () => {
    const { onMove } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30, 410);
    expect(marker()?.dataset.kanbanInsertion).toBe('card');
    expect(marker()?.dataset.beforeRowId).toBeUndefined();
    const preview = document.querySelector<HTMLElement>(
      '[data-kanban-preview]'
    )!;
    expect([
      preview.style.width,
      preview.style.height,
      preview.style.transform,
    ]).toEqual(['264px', '80px', 'none']);
    dropPointer(30, 410);
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('moving', 'Done'));
    expect(
      [
        ...screen
          .getByRole('region', { name: 'Done lane' })
          .querySelectorAll('[data-row-id]'),
      ].map((card) => card.getAttribute('data-row-id'))
    ).toEqual(['first', 'last', 'moving']);
    expect(marker()).toBeNull();
  });

  it('does not let the host sort projection override the chosen pointer gap', async () => {
    const projected = [
      initial[2],
      initial[0],
      { ...initial[1], cells: { ...initial[1].cells, stage: 'Done' } },
    ];
    const { onMove } = board(projected);
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30);
    expect(marker()?.dataset.kanbanInsertion).toBe('card');
    expect(marker()?.dataset.beforeRowId).toBe('first');
    dropPointer(30);
    await waitFor(() => expect(onMove).toHaveBeenCalledOnce());
    expect(
      [
        ...screen
          .getByRole('region', { name: 'Done lane' })
          .querySelectorAll('[data-row-id]'),
      ].map((card) => card.getAttribute('data-row-id'))
    ).toEqual(['moving', 'first', 'last']);
  });

  it('reorders within the same lane and rejects the unchanged adjacent gap', async () => {
    const { onPlace } = board();
    const last = screen.getByRole('button', { name: 'Open Last card' });
    fireEvent.mouseDown(last, { button: 0, clientX: 40, clientY: 180 });
    movePointer(40, 150);
    expect(marker()).toBeNull();
    movePointer(40, 70);
    expect(marker()?.dataset.beforeRowId).toBe('first');
    dropPointer(40, 70);
    await waitFor(() =>
      expect(onPlace).toHaveBeenCalledWith({
        rowId: 'last',
        value: 'Done',
        beforeId: 'first',
        toLane: 'value:"Done"',
        fromLane: 'value:"Done"',
      })
    );
    expect(
      Array.from(
        screen
          .getByRole('region', { name: 'Done lane' })
          .querySelectorAll('[data-kanban-card]')
      ).map((card) => card.getAttribute('data-kanban-card'))
    ).toEqual(['last', 'first']);
  });

  it('allows another drag of an optimistic card while its write is pending', async () => {
    const { onPlace } = board(undefined, true);
    const card = screen.getByRole('button', { name: 'Open Moving card' });
    expect((card as HTMLButtonElement).disabled).toBe(false);
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    movePointer(30, 150);
    dropPointer(30, 150);
    expect(onPlace).toHaveBeenCalledOnce();
    const moved = screen.getByRole('button', { name: 'Open Moving card' });
    fireEvent.mouseDown(moved, { button: 0, clientX: 40, clientY: 180 });
    movePointer(560, 70);
    dropPointer(560, 70);
    await waitFor(() => expect(onPlace).toHaveBeenCalledTimes(2));
    expect(
      screen
        .getByRole('region', { name: 'To do lane' })
        .contains(screen.getByRole('button', { name: 'Open Moving card' }))
    ).toBe(true);
  });

  it('does not offer a drop that active filters would hide', () => {
    const { onPlace } = board([]);
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30, 150);
    expect(marker()).toBeNull();
    dropPointer(30, 150);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('inserts into an empty lane without changing the chosen destination', async () => {
    const { onPlace } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(680, 150);
    expect(marker()?.dataset.laneId).toBe('empty');
    expect(marker()?.dataset.beforeRowId).toBeUndefined();
    dropPointer(680, 150);
    await waitFor(() =>
      expect(onPlace).toHaveBeenCalledWith({
        rowId: 'moving',
        value: null,
        beforeId: undefined,
        fromLane: 'value:"To do"',
        toLane: 'empty',
      })
    );
  });

  it('prevents native link or image dragging from taking over card movement', () => {
    board();
    const card = screen.getByRole('button', { name: 'Open Moving card' });
    const image = document.createElement('img');
    card.append(image);
    const event = new MouseEvent('dragstart', {
      bubbles: true,
      cancelable: true,
    });
    image.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('uses pointer-side lane insertion and hides adjacent no-op gaps', () => {
    const { onOrder, onMove } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Reorder Done lane' }),
      { button: 0, clientX: 265, clientY: 20 }
    );
    movePointer(310, 20);
    expect(marker()).toBeNull();
    movePointer(560, 20);
    expect(marker()?.dataset.kanbanInsertion).toBe('lane');
    expect(marker()?.dataset.edge).toBe('after');
    expect(
      marker()?.closest('[data-kanban-lane]')?.getAttribute('aria-label')
    ).toBe('To do lane');
    dropPointer(560, 20);
    expect(onOrder).toHaveBeenCalledOnce();
    expect(
      screen
        .getAllByRole('region')
        .map((lane) => lane.getAttribute('aria-label'))
    ).toEqual(['To do lane', 'Done lane', 'No stage lane']);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('cancels an outside drop rather than choosing the nearest visible lane', () => {
    const { onMove } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30);
    expect(marker()).not.toBeNull();
    movePointer(910);
    expect(marker()).toBeNull();
    dropPointer(910);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('accepts the board space below short lanes and commits the displayed target', async () => {
    laneHeight = 160;
    const { onMove } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30, 410);
    expect(marker()?.dataset.beforeRowId).toBeUndefined();
    dropPointer(30, 410);
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('moving', 'Done'));
  });

  it.each([
    { source: 'To do', start: 565, target: 30 },
    { source: 'Done', start: 265, target: 850 },
  ])(
    'rejects a lane drop whose insertion line is clipped ($source)',
    ({ source, start, target }) => {
      const { onOrder } = board();
      fireEvent.mouseDown(
        screen.getByRole('button', { name: `Reorder ${source} lane` }),
        { button: 0, clientX: start, clientY: 20 }
      );
      movePointer(target, 20);
      expect(marker()).toBeNull();
      dropPointer(target, 20);
      expect(onOrder).not.toHaveBeenCalled();
    }
  );

  it('updates the lane target when scrolling beneath a stationary pointer', () => {
    const { onOrder } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Reorder Done lane' }),
      { button: 0, clientX: 265, clientY: 20 }
    );
    movePointer(560, 20);
    expect(
      marker()?.closest('[data-kanban-lane]')?.getAttribute('aria-label')
    ).toBe('To do lane');
    scrollOffset = 300;
    fireEvent.scroll(document.querySelector('.overflow-auto')!);
    expect(
      marker()?.closest('[data-kanban-lane]')?.getAttribute('aria-label')
    ).toBe('No stage lane');
    dropPointer(560, 20);
    expect(onOrder).toHaveBeenCalledOnce();
    expect(
      screen
        .getAllByRole('region')
        .map((lane) => lane.getAttribute('aria-label'))
    ).toEqual(['To do lane', 'No stage lane', 'Done lane']);
  });

  it('cancels the lane target when scrolling its insertion line out of view', () => {
    scrollOffset = -20;
    const { onOrder } = board();
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Reorder To do lane' }),
      { button: 0, clientX: 560, clientY: 20 }
    );
    movePointer(30, 20);
    expect(marker()?.dataset.edge).toBe('before');
    scrollOffset = 100;
    fireEvent.scroll(document.querySelector('.overflow-auto')!);
    expect(marker()).toBeNull();
    dropPointer(30, 20);
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('Escape clears the preview and cannot reactivate or commit before pointer release', () => {
    const { onMove, onOpen } = board();
    const card = screen.getByRole('button', { name: 'Open Moving card' });
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    movePointer(30);
    expect(marker()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(marker()).toBeNull();
    expect(document.querySelector('[data-kanban-preview]')).toBeNull();
    movePointer(50);
    expect(marker()).toBeNull();
    expect(document.querySelector('[data-kanban-preview]')).toBeNull();
    dropPointer(50);
    fireEvent.click(card);
    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('window blur cancels a drag and permits a fresh gesture after release', () => {
    const { onPlace } = board();
    const card = screen.getByRole('button', { name: 'Open Moving card' });
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    movePointer(30, 150);
    fireEvent(window, new Event('blur'));
    expect(marker()).toBeNull();
    expect(document.querySelector('[data-kanban-preview]')).toBeNull();
    movePointer(40, 150);
    dropPointer(40, 150);
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    movePointer(30, 150);
    dropPointer(30, 150);
    expect(onPlace).toHaveBeenCalledOnce();
  });
});
