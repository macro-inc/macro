import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CompanyKanbanCardSurface,
  CompanyKanbanColumn,
} from './CompanyKanbanPrimitives';

afterEach(cleanup);

it('preserves native card drag events and column drops across the shared presentation boundary', () => {
  const start = vi.fn();
  const end = vi.fn();
  const open = vi.fn();
  const drop = vi.fn((event: DragEvent) => event.preventDefault());
  const [dragging, setDragging] = createSignal(false);
  render(() => (
    <CompanyKanbanColumn
      data-testid="column"
      label="Proposal"
      icon={<span />}
      onDrop={drop}
    >
      <CompanyKanbanCardSurface
        data-testid="card"
        title={<span>Northwind</span>}
        icon={<span>N</span>}
        draggable
        dragging={dragging()}
        onDragStart={start}
        onDragEnd={end}
        onClick={open}
      />
    </CompanyKanbanColumn>
  ));
  const card = screen.getByTestId('card');
  const transfer = { getData: () => 'northwind' };
  fireEvent.dragStart(card, { dataTransfer: transfer });
  expect(start).toHaveBeenCalledOnce();
  setDragging(true);
  expect(card.classList.contains('opacity-40')).toBe(true);
  fireEvent.drop(screen.getByTestId('column'), { dataTransfer: transfer });
  expect(drop).toHaveBeenCalledOnce();
  expect(drop.mock.calls[0][0].dataTransfer?.getData('text/plain')).toBe(
    'northwind'
  );
  fireEvent.dragEnd(card);
  fireEvent.click(card);
  expect(end).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
});
