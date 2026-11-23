import { describe, expect, it } from 'vitest';
import { contactPipelineEntry } from '../tests/pipeline-entry-fixture';
import type { PipelineEntryCell } from './pipeline-entry';
import {
  isEmptyCell,
  isLongText,
  pipelineCellFit,
  pipelineEntryFields,
} from './pipeline-entry-fields';

const cells = contactPipelineEntry().cells;
const names = (list: PipelineEntryCell[]) =>
  list.map((cell) => cell.column.name);

function text(
  value: string | null,
  dataType: PipelineEntryCell['column']['dataType'] = 'STRING'
): PipelineEntryCell {
  return {
    column: {
      id: 'text',
      name: 'Text',
      dataType,
      isMultiSelect: false,
      options: [],
      writable: true,
    },
    value,
  };
}

describe('isEmptyCell', () => {
  it('treats a checkbox as set even without a value', () => {
    expect(isEmptyCell(text(null, 'BOOLEAN'))).toBe(false);
  });

  it('treats missing, blank and empty multi-select values as empty', () => {
    expect(isEmptyCell(text(null))).toBe(true);
    expect(isEmptyCell(text(''))).toBe(true);
    expect(
      isEmptyCell({
        ...text('[]', 'SELECT_STRING'),
        column: { ...text('[]').column, isMultiSelect: true },
      })
    ).toBe(true);
    expect(isEmptyCell({ ...text(null), value: 0 })).toBe(false);
  });
});

describe('isLongText', () => {
  it('reads paragraphs and sentences as long, and addresses as one line', () => {
    expect(isLongText(text('Hi,\n\nThanks'))).toBe(true);
    expect(
      isLongText(text('Skipped: using Macro, 5 of the last 14 days'))
    ).toBe(true);
    expect(isLongText(text('How’s Macro going?'))).toBe(false);
    expect(
      isLongText(text('someone.with.a.long.address@harborlinefield.example'))
    ).toBe(false);
    expect(isLongText(text('A sentence that is long enough', 'LINK'))).toBe(
      false
    );
  });
});

describe('pipelineEntryFields', () => {
  it('lists the first six filled fields while collapsed', () => {
    const fields = pipelineEntryFields(cells, isEmptyCell, 'collapsed');
    expect(names(fields.shown)).toEqual([
      'Status',
      "Today's list",
      'Pinned',
      'Play',
      'Why',
      'Score',
    ]);
    expect(fields.folded).toEqual([]);
    expect(fields.hidden).toBe(15);
    expect(fields.clamped).toBe(true);
  });

  it('lists every filled field and folds the empty ones once expanded', () => {
    const fields = pipelineEntryFields(cells, isEmptyCell, 'filled');
    expect(fields.shown).toHaveLength(17);
    expect(names(fields.shown)).not.toContain('Notes');
    expect(names(fields.folded)).toEqual([
      'Trial ends',
      'Notes',
      'LinkedIn',
      'Last outreach',
    ]);
    expect(fields.hidden).toBe(0);
    expect(fields.clamped).toBe(false);
  });

  it('lists every field in column order once the fold opens', () => {
    const fields = pipelineEntryFields(cells, isEmptyCell, 'all');
    expect(names(fields.shown)).toEqual(names(cells));
    expect(fields.folded).toEqual([]);
  });

  it('shows a short card whole, with its empty fields folded', () => {
    const short = cells.filter(
      (cell) =>
        isEmptyCell(cell) || ['Status', 'Draft'].includes(cell.column.name)
    );
    const fields = pipelineEntryFields(short, isEmptyCell, 'collapsed');
    expect(names(fields.shown)).toEqual(['Status', 'Draft']);
    expect(fields.folded).toHaveLength(4);
    expect(fields.hidden).toBe(0);
    expect(fields.clamped).toBe(false);
  });

  it('keeps a field the card read as filled in place after it is cleared', () => {
    const settled = new Set(
      cells.filter(isEmptyCell).map((cell) => cell.column.id)
    );
    const cleared = cells.map((cell) =>
      cell.column.name === 'Status' ? { ...cell, value: null } : cell
    );
    const fields = pipelineEntryFields(
      cleared,
      (cell) => settled.has(cell.column.id),
      'collapsed'
    );
    expect(names(fields.shown)[0]).toBe('Status');
  });
});

describe('pipelineCellFit', () => {
  it('clamps long text only while the card is cut short', () => {
    const draft = cells.find((cell) => cell.column.name === 'Draft');
    const email = cells.find((cell) => cell.column.name === 'Primary email');
    if (!draft || !email) throw new Error('fixture changed');
    expect(pipelineCellFit(draft, true)).toBe('clamp');
    expect(pipelineCellFit(draft, false)).toBe('full');
    expect(pipelineCellFit(email, false)).toBe('line');
  });
});
