import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { unknownNames } from '../core/answer-cell';
import type { QueryAnswer } from '../core/query';
import { plainAnswerRenderers } from '../tests/plain-answer-display';
import { QueryResults } from './query-results';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));
const scalar: QueryAnswer = {
  columns: [{ name: 'Approved', kind: 'number' }],
  rows: [[{ type: 'number', value: 5 }]],
  rowIds: [],
  readTables: [],
  readDatabaseIds: [],
  truncatedTables: [],
};
describe('question result display', () => {
  it.each(['bar', 'line', 'pie'] as const)(
    'renders a real %s chart and retains its underlying data',
    (displayMode) => {
      const answer: QueryAnswer = {
        ...scalar,
        columns: [
          { name: 'Status', kind: 'text' },
          { name: 'Count', kind: 'number' },
        ],
        rows: [
          [
            { type: 'text', value: 'Todo' },
            { type: 'number', value: 3 },
          ],
          [
            { type: 'text', value: 'Done' },
            { type: 'number', value: 2 },
          ],
        ],
      };
      const result = render(() => (
        <QueryResults
          names={unknownNames}
          display={plainAnswerRenderers}
          answer={answer}
          displayMode={displayMode}
          chart={{ x: 'Status', y: ['Count'], title: 'Tasks by status' }}
        />
      ));
      expect(
        result.getByRole('img', {
          name: new RegExp(`Tasks by status. ${displayMode}`, 'i'),
        })
      ).toBeTruthy();
      expect(result.getByText('View data')).toBeTruthy();
      expect(result.getByRole('table', { hidden: true }).textContent).toContain(
        'Todo'
      );
      result.unmount();
    }
  );
  it('explains invalid chart data and falls back to the actual table', () => {
    const result = render(() => (
      <QueryResults
        names={unknownNames}
        display={plainAnswerRenderers}
        answer={scalar}
        displayMode="bar"
        chart={{ x: 'Status', y: ['Count'] }}
      />
    ));
    expect(result.queryByRole('img')).toBeNull();
    expect(result.getByRole('status').textContent).toContain('label column');
    expect(result.getByRole('cell').textContent).toBe('5');
    result.unmount();
  });
  it('honors an explicit table choice for a one-cell answer', () => {
    const result = render(() => (
      <QueryResults
        names={unknownNames}
        display={plainAnswerRenderers}
        answer={scalar}
        displayMode="table"
      />
    ));
    expect(result.getByRole('table')).toBeTruthy();
    expect(result.getByRole('columnheader').textContent).toBe('Approved');
    expect(result.getByRole('cell').textContent).toBe('5');
    result.unmount();
  });
  it('renders string scalar answers without calling them numbers', () => {
    const answer: QueryAnswer = {
      ...scalar,
      columns: [{ name: 'Approved', kind: 'text' }],
      rows: [[{ type: 'text', value: 'Ready' }]],
    };
    const result = render(() => (
      <QueryResults
        names={unknownNames}
        display={plainAnswerRenderers}
        answer={answer}
        displayMode="scalar"
      />
    ));
    expect(result.queryByRole('table')).toBeNull();
    expect(result.getByText('Ready')).toBeTruthy();
    result.unmount();
  });

  it('keeps row ids out of result tables', () => {
    const answer: QueryAnswer = {
      ...scalar,
      columns: [{ name: 'Title', kind: 'text' }],
      rows: [
        [{ type: 'text', value: 'Launch plan' }],
        [{ type: 'text', value: 'Hiring' }],
      ],
      rowIds: ['0190a3c4-row-1', '0190a3c4-row-2'],
    };
    const result = render(() => (
      <QueryResults
        names={unknownNames}
        display={plainAnswerRenderers}
        answer={answer}
        displayMode="table"
      />
    ));
    const table = result.getByRole('table');
    expect(
      Array.from(table.querySelectorAll('th')).map((cell) => cell.textContent)
    ).toEqual(['Title']);
    expect(
      Array.from(table.querySelectorAll('td')).map((cell) => cell.textContent)
    ).toEqual(['Launch plan', 'Hiring']);
    result.unmount();
  });

  it('draws each column kind as the database grid does', () => {
    const plain = {
      markdown: false,
      options: [],
      tag: false,
      target: null,
      relatedTable: null,
    };
    const answer: QueryAnswer = {
      ...scalar,
      readDatabaseIds: ['party-planner'],
      columns: [
        { name: 'Name', kind: 'text', source: { ...plain, markdown: true } },
        { name: 'Date', kind: 'date', source: plain },
        { name: 'Guests', kind: 'number' },
        { name: 'Plus One', kind: 'boolean', source: plain },
        {
          name: 'RSVP',
          kind: 'select',
          source: {
            ...plain,
            options: [{ id: 'maybe', label: 'Maybe', color: 'amber' }],
          },
        },
        { name: 'Host', kind: 'entity', source: { ...plain, target: 'USER' } },
        {
          name: 'Plan',
          kind: 'entity',
          source: { ...plain, target: 'DOCUMENT' },
        },
        { name: 'Task', kind: 'entity', source: { ...plain, target: 'TASK' } },
        {
          name: 'Vendors',
          kind: 'entity',
          source: {
            ...plain,
            target: 'DATABASE_ROW',
            relatedTable: 'vendors',
          },
        },
        {
          name: 'Venue',
          kind: 'entity',
          source: {
            ...plain,
            target: 'DATABASE_ROW',
            relatedTable: 'venues',
          },
        },
      ],
      rows: [
        [
          { type: 'text', value: 'Gala' },
          { type: 'date', value: '2025-12-31T00:00:00+00:00' },
          { type: 'number', value: 1200 },
          { type: 'bool', value: true },
          { type: 'options', value: ['maybe'] },
          { type: 'entities', value: ['macro|ada@macro.com'] },
          { type: 'entities', value: ['doc-1'] },
          { type: 'entities', value: ['task-1'] },
          { type: 'entities', value: ['v1', 'v2', 'v3', 'v4', 'v5'] },
          { type: 'entities', value: ['hall', 'barn'] },
        ],
      ],
    };
    const vendors = new Map([
      ['v1', 'Bakery'],
      ['v2', 'Florist'],
      ['v3', 'Band'],
      ['v4', 'Caterer'],
    ]);
    const result = render(() => (
      <QueryResults
        answer={answer}
        displayMode="table"
        names={({ kind, id, table }) =>
          kind === 'DATABASE_ROW' && table === 'vendors'
            ? vendors.get(id)
            : undefined
        }
        display={{
          mention: (id, entityType) => (
            <span
              data-testid={`${entityType}-mention`}
            >{`${entityType} ${id}`}</span>
          ),
          row: (row) => row.label,
          text: (markdown) => <span data-testid="markdown">{markdown}</span>,
        }}
      />
    ));
    const cells = Array.from(result.getByRole('table').querySelectorAll('td'));
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Gala',
      'Dec 31, 2025',
      '1,200',
      '',
      'Maybe',
      'USER macro|ada@macro.com',
      'DOCUMENT doc-1',
      'TASK task-1',
      'Bakery, Florist, Band +2',
      '2 linked records',
    ]);
    expect(cells[0].querySelector('[data-testid="markdown"]')).toBeTruthy();
    expect(
      cells[3].querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked
    ).toBe(true);
    expect(cells[4].querySelector('[title="Maybe"]')).toBeTruthy();
    expect(cells[5].querySelector('[data-testid="USER-mention"]')).toBeTruthy();
    expect(
      cells[6].querySelector('[data-testid="DOCUMENT-mention"]')
    ).toBeTruthy();
    expect(cells[7].querySelector('[data-testid="TASK-mention"]')).toBeTruthy();
    result.unmount();
  });

  it('draws values without a known column from the engine’s types', () => {
    const answer: QueryAnswer = {
      ...scalar,
      columns: [
        { name: 'Owner', kind: 'entity' },
        { name: 'Due', kind: 'date' },
        { name: 'Code', kind: 'text' },
      ],
      rows: [
        [
          { type: 'entities', value: ['macro|ada@macro.com'] },
          { type: 'date', value: '2025-07-19T00:00:00+00:00' },
          { type: 'text', value: '2025-07-19' },
        ],
      ],
    };
    const result = render(() => (
      <QueryResults
        names={unknownNames}
        display={plainAnswerRenderers}
        answer={answer}
        displayMode="table"
      />
    ));
    const cells = Array.from(result.getByRole('table').querySelectorAll('td'));
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'macro|ada@macro.com',
      'Jul 19, 2025',
      '2025-07-19',
    ]);
    result.unmount();
  });

  it('shows a single date answer as a date', () => {
    const answer: QueryAnswer = {
      ...scalar,
      columns: [{ name: 'Next party', kind: 'date' }],
      rows: [[{ type: 'date', value: '2025-12-31T00:00:00+00:00' }]],
    };
    const result = render(() => (
      <QueryResults
        names={unknownNames}
        display={plainAnswerRenderers}
        answer={answer}
        displayMode="scalar"
      />
    ));
    expect(result.getByText('Dec 31, 2025')).toBeTruthy();
    expect(result.queryByText(/2025-12-31/)).toBeNull();
    result.unmount();
  });
});
