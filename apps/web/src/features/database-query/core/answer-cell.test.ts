import { describe, expect, it } from 'vitest';
import { referenceList, resultCell, resultCellText } from './answer-cell';

describe('result cells from the engine’s typed cells', () => {
  it('shows a calendar day as that local day, without a time', () => {
    const cell = resultCell(
      { type: 'date', value: '2025-12-31T00:00:00Z' },
      { name: 'Due', kind: 'date' }
    );

    expect(cell).toEqual({
      kind: 'date',
      date: new Date(2025, 11, 31),
      calendarDay: true,
    });
    expect(resultCellText(cell)).toBe('Dec 31, 2025');
  });

  it('keeps the time of a moment', () => {
    const cell = resultCell(
      { type: 'date', value: '2025-12-31T15:30:00Z' },
      { name: 'At', kind: 'date' }
    );

    expect(cell).toEqual({
      kind: 'date',
      date: new Date('2025-12-31T15:30:00Z'),
      calendarDay: false,
    });
    expect(resultCellText(cell)).toBe(
      `Dec 31, 2025, ${new Date('2025-12-31T15:30:00Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    );
  });

  it('formats numbers and leaves text alone', () => {
    const total = resultCell(
      { type: 'number', value: 1234.5 },
      { name: 'Total', kind: 'number' }
    );

    expect(total).toEqual({ kind: 'number', value: 1234.5 });
    expect(resultCellText(total)).toBe('1,234.5');
    expect(
      resultCell(
        { type: 'text', value: '2025' },
        { name: 'Year', kind: 'text' }
      )
    ).toEqual({ kind: 'text', text: '2025' });
  });

  it('reads a table’s text property as markdown', () => {
    expect(
      resultCell(
        { type: 'text', value: '**Skyline** Rooftop' },
        {
          name: 'Location',
          kind: 'text',
          source: {
            markdown: true,
            options: [],
            tag: false,
            target: null,
            relatedTable: null,
          },
        }
      )
    ).toEqual({ kind: 'markdown', markdown: '**Skyline** Rooftop' });
  });

  it('shows a missing value and empty text as empty', () => {
    expect(resultCell(null, { name: 'Due', kind: 'date' })).toEqual({
      kind: 'empty',
    });
    expect(
      resultCell({ type: 'text', value: '' }, { name: 'Name', kind: 'text' })
    ).toEqual({ kind: 'empty' });
  });

  it('labels option ids with the column’s options and their colours', () => {
    const cell = resultCell(
      { type: 'options', value: ['option-vegan', 'option-nuts'] },
      {
        name: 'Diet',
        kind: 'select',
        source: {
          markdown: false,
          options: [
            { id: 'option-vegan', label: 'Vegan', color: '#2f9e44' },
            { id: 'option-nuts', label: 'No nuts', color: null },
          ],
          tag: true,
          target: null,
          relatedTable: null,
        },
      }
    );

    expect(cell).toEqual({
      kind: 'options',
      options: [
        { id: 'option-vegan', label: 'Vegan', color: '#2f9e44' },
        { id: 'option-nuts', label: 'No nuts', color: null },
      ],
      tag: true,
    });
    expect(resultCellText(cell)).toBe('Vegan, No nuts');
  });

  it('shows an option id the column no longer has as an unknown option', () => {
    const cell = resultCell(
      { type: 'options', value: ['option-vegan', 'option-deleted'] },
      {
        name: 'Diet',
        kind: 'select',
        source: {
          markdown: false,
          options: [{ id: 'option-vegan', label: 'Vegan', color: '#2f9e44' }],
          tag: false,
          target: null,
          relatedTable: null,
        },
      }
    );

    expect(cell).toEqual({
      kind: 'options',
      options: [
        { id: 'option-vegan', label: 'Vegan', color: '#2f9e44' },
        { id: 'option-deleted', label: 'Unknown option', color: null },
      ],
      tag: false,
    });
    expect(resultCellText(cell)).toBe('Vegan, Unknown option');
  });

  it('reads booleans as checkboxes', () => {
    expect(
      resultCell(
        { type: 'bool', value: true },
        { name: 'Plus one', kind: 'boolean' }
      )
    ).toEqual({ kind: 'boolean', checked: true });
  });

  it('turns entity ids into mentions of the column’s target', () => {
    expect(
      resultCell(
        { type: 'entities', value: ['doc_1', 'doc_2'] },
        {
          name: 'Documents',
          kind: 'entity',
          source: {
            markdown: false,
            options: [],
            tag: false,
            target: 'DOCUMENT',
            relatedTable: null,
          },
        }
      )
    ).toEqual({
      kind: 'mentions',
      entityType: 'DOCUMENT',
      ids: ['doc_1', 'doc_2'],
    });
  });

  it('keeps a relation’s row ids with the table they belong to', () => {
    expect(
      resultCell(
        { type: 'entities', value: ['row-party'] },
        {
          name: 'Parties',
          kind: 'entity',
          source: {
            markdown: false,
            options: [],
            tag: false,
            target: 'DATABASE_ROW',
            relatedTable: 'table-parties',
          },
        }
      )
    ).toEqual({ kind: 'rows', ids: ['row-party'], table: 'table-parties' });
  });
});

describe('names instead of counts', () => {
  it('names people, up to three, then says how many more', () => {
    const names: Record<string, string> = {
      'macro|ada@x.test': 'Ada Lovelace',
      'macro|grace@x.test': 'Grace Hopper',
      'macro|alan@x.test': 'Alan Turing',
      'macro|edsger@x.test': 'Edsger Dijkstra',
    };

    expect(
      resultCellText(
        {
          kind: 'mentions',
          entityType: 'USER',
          ids: [
            'macro|ada@x.test',
            'macro|grace@x.test',
            'macro|alan@x.test',
            'macro|edsger@x.test',
          ],
        },
        ({ id }) => names[id]
      )
    ).toBe('Ada Lovelace, Grace Hopper, Alan Turing +1');
  });

  it('names linked rows from their table', () => {
    expect(
      resultCellText(
        { kind: 'rows', ids: ['row-1', 'row-2'], table: 'table-parties' },
        ({ kind, id, table }) =>
          kind === 'DATABASE_ROW' && table === 'table-parties'
            ? { 'row-1': 'Launch party', 'row-2': 'Offsite' }[id]
            : undefined
      )
    ).toBe('Launch party, Offsite');
  });

  it('counts what it cannot name among names it knows', () => {
    expect(referenceList('USER', ['Ada Lovelace', undefined, undefined])).toBe(
      'Ada Lovelace +2'
    );
  });

  it('falls back to the count only when no name is known', () => {
    expect(
      resultCellText({
        kind: 'rows',
        ids: ['row-1', 'row-2'],
        table: null,
      })
    ).toBe('2 linked records');
    expect(
      resultCellText({ kind: 'mentions', entityType: 'USER', ids: ['u'] })
    ).toBe('1 person');
  });
});
