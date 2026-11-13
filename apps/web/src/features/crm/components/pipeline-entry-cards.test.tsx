import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PipelineEntry, PipelineEntryCell } from '../core/pipeline-entry';
import { contactPipelineEntry } from '../tests/pipeline-entry-fixture';
import {
  type PipelineCellDisplay,
  PipelineEntryCards,
} from './pipeline-entry-cards';

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom has no layout, so it leaves scrolling out.
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockReset();
});

afterEach(cleanup);

/** A stand-in for the grid cell: the field's value, or what an empty one says. */
function renderCell(
  _entry: Accessor<PipelineEntry>,
  cell: Accessor<PipelineEntryCell>,
  display: PipelineCellDisplay
) {
  return (
    <button
      type="button"
      data-cell-display
      data-fit={display.fit}
      aria-label={cell().column.name}
    >
      {cell().value === null ? display.emptyLabel : String(cell().value)}
    </button>
  );
}

function entry(name: string, shared: boolean, fields: string[]): PipelineEntry {
  return {
    rowId: `${name}-row`,
    pipeline: {
      id: name,
      name,
      tableId: `${name}-table`,
      shared,
      canEdit: true,
    },
    cells: fields.map((field) => ({
      column: {
        id: `${name}-${field}`,
        name: field,
        dataType: 'STRING',
        isMultiSelect: false,
        options: [],
        writable: true,
      },
      value: `${field} value`,
    })),
  };
}

/** The fields a card lists, top to bottom. */
function listed(card: HTMLElement) {
  return [...card.querySelectorAll('[data-cell-display]')].map((field) =>
    field.getAttribute('aria-label')
  );
}

function field(card: HTMLElement, name: string) {
  return within(card).getByRole('button', { name });
}

it('renders nothing when the record is in no pipeline', () => {
  render(() => <PipelineEntryCards entries={[]} renderCell={renderCell} />);
  expect(screen.queryByRole('region', { name: 'Pipelines' })).toBeNull();
});

it('lists the first six filled fields, then every filled one with the empty ones folded', () => {
  render(() => (
    <PipelineEntryCards
      entries={[contactPipelineEntry()]}
      renderCell={renderCell}
    />
  ));
  const card = screen.getByRole('article', { name: 'Trial outreach' });
  expect(listed(card)).toEqual([
    'Status',
    "Today's list",
    'Pinned',
    'Play',
    'Why',
    'Score',
  ]);
  expect(field(card, 'Why').dataset.fit).toBe('clamp');
  expect(field(card, 'Score').dataset.fit).toBe('line');
  expect(
    within(card).queryByRole('button', { name: /empty field/ })
  ).toBeNull();

  fireEvent.click(within(card).getByRole('button', { name: 'Show 15 more' }));
  expect(listed(card)).toHaveLength(17);
  expect(listed(card)).not.toContain('Notes');
  expect(listed(card).at(-1)).toBe('Auto draft');
  expect(field(card, 'Why').dataset.fit).toBe('full');
  expect(field(card, 'Primary email').dataset.fit).toBe('line');
  expect(
    within(card).getByRole('button', {
      name: '4 empty fields: Trial ends, Notes, LinkedIn, Last outreach',
    })
  ).toBeTruthy();
  expect(scrollIntoView).not.toHaveBeenCalled();

  fireEvent.click(within(card).getByRole('button', { name: 'Show less' }));
  expect(listed(card)).toHaveLength(6);
  expect(scrollIntoView.mock.contexts).toEqual([card]);
});

it('opens the empty fields in place, each saying Empty', () => {
  render(() => (
    <PipelineEntryCards
      entries={[contactPipelineEntry()]}
      renderCell={renderCell}
    />
  ));
  const card = screen.getByRole('article', { name: 'Trial outreach' });
  fireEvent.click(within(card).getByRole('button', { name: 'Show 15 more' }));
  const fold = within(card).getByRole('button', { name: /4 empty fields/ });
  fold.focus();
  fireEvent.click(fold);

  expect(listed(card)).toEqual(
    contactPipelineEntry().cells.map((cell) => cell.column.name)
  );
  expect(field(card, 'Notes').textContent).toBe('Empty');
  expect(field(card, 'Pinned').textContent).toBe('');
  expect(document.activeElement).toBe(field(card, 'Trial ends'));
  expect(
    within(card).queryByRole('button', { name: /empty field/ })
  ).toBeNull();

  fireEvent.click(within(card).getByRole('button', { name: 'Show less' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Show 15 more' }));
  expect(
    within(card).getByRole('button', { name: /4 empty fields/ })
  ).toBeTruthy();
});

it('shows a short card whole, with its empty fields folded below', () => {
  const short = contactPipelineEntry();
  short.cells = short.cells.filter((cell) =>
    ['Status', 'Draft', 'Notes', 'LinkedIn'].includes(cell.column.name)
  );
  render(() => (
    <PipelineEntryCards entries={[short]} renderCell={renderCell} />
  ));
  const card = screen.getByRole('article', { name: 'Trial outreach' });
  expect(listed(card)).toEqual(['Status', 'Draft']);
  expect(field(card, 'Draft').dataset.fit).toBe('full');
  expect(within(card).queryByRole('button', { name: /more/ })).toBeNull();

  fireEvent.click(within(card).getByRole('button', { name: /2 empty fields/ }));
  expect(listed(card)).toEqual(['Status', 'Draft', 'Notes', 'LinkedIn']);
  fireEvent.click(within(card).getByRole('button', { name: 'Show less' }));
  expect(listed(card)).toEqual(['Status', 'Draft']);
});

it('keeps a cleared field in its row until the card folds again', () => {
  const [entries, setEntries] = createSignal([contactPipelineEntry()]);
  render(() => (
    <PipelineEntryCards entries={entries()} renderCell={renderCell} />
  ));
  const card = screen.getByRole('article', { name: 'Trial outreach' });
  const cleared = contactPipelineEntry();
  cleared.cells = cleared.cells.map((cell) =>
    cell.column.name === 'Status' ? { ...cell, value: null } : cell
  );
  setEntries([cleared]);
  expect(listed(card)[0]).toBe('Status');
  expect(field(card, 'Status').textContent).toBe('Empty');

  fireEvent.click(within(card).getByRole('button', { name: 'Show 15 more' }));
  expect(listed(card)).not.toContain('Status');
  expect(
    within(card).getByRole('button', { name: /5 empty fields: Status, / })
  ).toBeTruthy();
});

it('marks a private pipeline and collapses the section from its header', () => {
  render(() => (
    <PipelineEntryCards
      entries={[entry('Sales', true, ['Stage']), entry('Partners', false, [])]}
      renderCell={renderCell}
    />
  ));
  expect(screen.getByLabelText('Private pipeline')).toBeTruthy();
  expect(
    within(screen.getByRole('article', { name: 'Sales' })).queryByRole(
      'button',
      { name: /Show/ }
    )
  ).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Pipelines' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByRole('region', { name: 'Pipelines' })).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByRole('article')).toHaveLength(2);
});

it('opens a card’s pipeline when the host can show it', () => {
  const onOpenPipeline = vi.fn();
  render(() => (
    <PipelineEntryCards
      entries={[entry('Sales', true, ['Stage'])]}
      renderCell={renderCell}
      onOpenPipeline={onOpenPipeline}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open Sales' }));
  expect(onOpenPipeline).toHaveBeenCalledWith('Sales');
});
