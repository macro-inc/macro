import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import { DatabaseBoard } from './database-board';

let scrollOffset = 0;

// Lanes sit side by side, Done at 0, To do at 300 and No stage at 600; each
// lane's cards stack from y = 60, 100 apart and 80 tall.
beforeEach(() => {
  scrollOffset = 0;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('overflow-auto'))
        return new DOMRect(0, 0, 880, 500);
      const lane = this.closest('[data-kanban-lane]');
      const label = lane?.getAttribute('aria-label');
      const x =
        (label === 'To do lane' ? 300 : label === 'Later lane' ? 600 : 0) -
        scrollOffset;
      const cardIndex = lane
        ? Array.from(lane.querySelectorAll('[data-kanban-card]')).indexOf(this)
        : 0;
      return this.hasAttribute('data-row-id')
        ? new DOMRect(x + 8, 60 + Math.max(0, cardIndex) * 100, 264, 80)
        : new DOMRect(x, 0, 280, 500);
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const marker = () =>
  document.querySelector<HTMLElement>('[data-kanban-insertion]');
const movePointer = (x: number, y = 90) =>
  fireEvent.mouseMove(document, { clientX: x, clientY: y });
const dropPointer = (x: number, y = 90) =>
  fireEvent.mouseUp(document, { button: 0, clientX: x, clientY: y });

describe('board card drag', () => {
  it('drops a card into another lane in front of the card below the pointer', async () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    const onOpen = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
          { rowId: 'last', cells: { name: 'Last card', stage: 'Done' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'done' },
              hidden: false,
              cards: ['first', 'last'],
            },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['moving'],
            },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={onOpen}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const card = screen.getByRole('button', { name: 'Open Moving card' });
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    movePointer(30, 150);
    expect(marker()?.dataset.kanbanInsertion).toBe('card');
    const preview = document.querySelector<HTMLElement>(
      '[data-kanban-preview]'
    )!;
    expect([
      preview.style.width,
      preview.style.height,
      preview.style.transform,
    ]).toEqual(['264px', '80px', 'none']);
    dropPointer(30, 150);
    fireEvent.click(card);
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(
        'moving',
        { kind: 'option', id: 'done' },
        'last'
      )
    );
    expect(onMove).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(marker()).toBeNull();
  });

  it("drops a card at a lane's end with no card to land in front of", async () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
          { rowId: 'last', cells: { name: 'Last card', stage: 'Done' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'done' },
              hidden: false,
              cards: ['first', 'last'],
            },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['moving'],
            },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30, 410);
    expect(marker()?.dataset.beforeRowId).toBeUndefined();
    dropPointer(30, 410);
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(
        'moving',
        { kind: 'option', id: 'done' },
        undefined
      )
    );
  });

  it('does not offer the unassigned lane as a drop target', async () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'done' },
              hidden: false,
              cards: ['first'],
            },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['moving'],
            },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(680, 150);
    expect(marker()).toBeNull();
    dropPointer(680, 150);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('reorders a card within its lane and ignores the gap it already sits in', async () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done', color: null }],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'last', cells: { name: 'Last card', stage: 'Done' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'done' },
              hidden: false,
              cards: ['first', 'last'],
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Last card' }),
      {
        button: 0,
        clientX: 40,
        clientY: 180,
      }
    );
    movePointer(40, 150);
    expect(marker()).toBeNull();
    movePointer(40, 70);
    expect(marker()?.dataset.beforeRowId).toBe('first');
    dropPointer(40, 70);
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(
        'last',
        { kind: 'option', id: 'done' },
        'first'
      )
    );
  });

  it('cancels an outside drop rather than choosing the nearest lane', () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['moving'],
            },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
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

  it('Escape cancels a drag, which cannot commit before the pointer is released', () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    const onOpen = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['moving'],
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={onOpen}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const card = screen.getByRole('button', { name: 'Open Moving card' });
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    movePointer(30);
    expect(marker()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(marker()).toBeNull();
    expect(document.querySelector('[data-kanban-preview]')).toBeNull();
    movePointer(50);
    expect(marker()).toBeNull();
    dropPointer(50);
    fireEvent.click(card);
    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not let a viewer drag a card', () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['moving'],
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit={false}
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open Moving card' }),
      { button: 0, clientX: 560, clientY: 80 }
    );
    movePointer(30);
    expect(marker()).toBeNull();
    dropPointer(30);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('board lane drag', () => {
  it('names every lane, hidden ones too, in the order a lane drop makes', () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
        { id: 'archived', label: 'Archived', color: null },
      ],
      writable: true,
    };
    const onLaneOrderChange = vi.fn();
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            { key: { kind: 'none' }, hidden: false, cards: [] },
            {
              key: { kind: 'option', id: 'archived' },
              hidden: true,
              cards: [],
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onLaneOrderChange={onLaneOrderChange}
        onCreate={vi.fn(async () => true)}
      />
    ));
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
    expect(onLaneOrderChange).toHaveBeenCalledOnce();
    expect(onLaneOrderChange).toHaveBeenCalledWith([
      { kind: 'option', id: 'todo' },
      { kind: 'option', id: 'done' },
      { kind: 'none' },
      { kind: 'option', id: 'archived' },
    ]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('drops a lane where the scrolled board puts the pointer', () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
        { id: 'later', label: 'Later', color: null },
      ],
      writable: true,
    };
    const onLaneOrderChange = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'later' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onLaneOrderChange={onLaneOrderChange}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Reorder Done lane' }),
      { button: 0, clientX: 265, clientY: 20 }
    );
    movePointer(560, 20);
    scrollOffset = 300;
    fireEvent.scroll(document.querySelector('.overflow-auto')!);
    expect(
      marker()?.closest('[data-kanban-lane]')?.getAttribute('aria-label')
    ).toBe('Later lane');
    dropPointer(560, 20);
    expect(onLaneOrderChange).toHaveBeenCalledWith([
      { kind: 'option', id: 'todo' },
      { kind: 'option', id: 'later' },
      { kind: 'option', id: 'done' },
    ]);
  });

  it('rejects a lane drop whose insertion line is clipped out of view', () => {
    const stage: DatabaseViewColumn = {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'done', label: 'Done', color: null },
        { id: 'todo', label: 'To do', color: null },
      ],
      writable: true,
    };
    const onLaneOrderChange = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          stage,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'stage',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={stage}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onLaneOrderChange={onLaneOrderChange}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Reorder Done lane' }),
      { button: 0, clientX: 265, clientY: 20 }
    );
    movePointer(850, 20);
    expect(marker()).toBeNull();
    dropPointer(850, 20);
    expect(onLaneOrderChange).not.toHaveBeenCalled();
  });
});
