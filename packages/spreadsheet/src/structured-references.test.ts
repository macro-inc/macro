import { describe, expect, it } from 'vitest';
import {
  displayStructuredReferences,
  protectStructuredReferences,
  qualifyStructuredReferences,
  referencedTableNames,
  renameTableReferences,
  resolveStructuredReferences,
  type WorkbookTable,
} from './structured-references';

const sales: WorkbookTable = {
  name: 'Sales',
  sheet: 'Data',
  top: 0,
  left: 0,
  bottom: 4,
  right: 2,
  headerRows: 1,
  totalsRows: 1,
  columns: ['Region', 'Unit Price', 'Qty'],
};

describe('structured references', () => {
  it('resolves to cell ranges, with #REF! for missing tables and columns in calculation', () => {
    expect(
      resolveStructuredReferences(
        '=SUM(Sales[Qty])+[@[Unit Price]]',
        [sales],
        'Data',
        2,
        2
      )
    ).toBe('=SUM($C$2:$C$4)+$B3');
    expect(
      resolveStructuredReferences('=Sales[#Totals]', [sales], 'Other', 0, 0)
    ).toBe('=Data!$A$5:$C$5');
    expect(
      resolveStructuredReferences('=Sales[Missing]', [sales], 'Data', 9, 9)
    ).toBeUndefined();
    expect(
      resolveStructuredReferences(
        '=Gone[Qty]+Sales[Missing]',
        [sales],
        'Data',
        9,
        9,
        { unresolved: '#REF!' }
      )
    ).toBe('=#REF!+#REF!');
  });

  it('writes the file form for export and the shown form for import', () => {
    const shown = '=[@Qty]*[@[Unit Price]]+SUM(Sales[Qty])';
    const stored =
      '=Sales[[#This Row],[Qty]]*Sales[[#This Row],[Unit Price]]+SUM(Sales[Qty])';
    expect(qualifyStructuredReferences(shown, [sales], 'Data', 2, 2)).toBe(
      stored
    );
    expect(displayStructuredReferences(stored, [sales], 'Data', 2, 2)).toBe(
      '=[@Qty]*[@[Unit Price]]+SUM([Qty])'
    );
    expect(displayStructuredReferences(stored, [sales], 'Other', 2, 2)).toBe(
      '=Sales[@Qty]*Sales[@[Unit Price]]+SUM(Sales[Qty])'
    );
  });

  it('renames only table references, not sheet names or text', () => {
    expect(
      renameTableReferences(
        '=Sales[Qty]+Sales!A1+"Sales[Qty]"+sales[#All]',
        'Sales',
        'Orders'
      )
    ).toBe('=Orders[Qty]+Sales!A1+"Sales[Qty]"+Orders[#All]');
    expect([
      ...referencedTableNames('=Sales[Qty]+[@Qty]+Orders[#All]'),
    ]).toEqual(['sales', 'orders']);
  });

  it('protects references while other references move, then restores them', () => {
    const references = protectStructuredReferences('=[@Qty]*B2+Sales[Qty]');
    expect(references.formula).toBe(
      '="__macro_table_reference_0"*B2+"__macro_table_reference_1"'
    );
    expect(
      references.restore(
        '="__macro_table_reference_0"*B3+"__macro_table_reference_1"'
      )
    ).toBe('=[@Qty]*B3+Sales[Qty]');
  });
});
