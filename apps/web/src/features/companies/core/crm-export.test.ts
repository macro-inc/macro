import { parseCsv } from '@core/util/csv';
import { describe, expect, it } from 'vitest';
import { createCrmCsv, personExportRecord } from './crm-export';

describe('CRM CSV export', () => {
  const columns = [
    { id: 'name', label: 'Name' },
    { id: 'value', label: 'Value' },
  ];
  it('round trips quotes, commas, newlines and unicode with a UTF-8 BOM', () => {
    const rows = [{ name: 'Zoë, "Founder"', value: 'first\nsecond' }];
    const csv = createCrmCsv(columns, rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const result = parseCsv(csv.slice(1));
    expect(result.ok && result.records).toEqual([
      { Name: rows[0].name, Value: rows[0].value },
    ]);
  });
  it('exports only selected columns, keeping zero and false', () => {
    expect(
      createCrmCsv(columns, [{ name: false, value: 0, hidden: 'private' }])
    ).toBe('\uFEFF"Name","Value"\r\n"false","0"\r\n');
  });
  it('neutralizes spreadsheet formulas in text without altering numeric values', () => {
    const csv = createCrmCsv(columns, [
      { name: ' =HYPERLINK("x")', value: -42 },
    ]);
    expect(csv).toContain('"\' =HYPERLINK(""x"")"');
    expect(csv).toContain('"-42"');
  });
  it('can export a deliberately empty view as headers only', () => {
    expect(createCrmCsv(columns, [])).toBe('\uFEFF"Name","Value"\r\n');
  });
  it('uses contact interaction dates rather than record modification dates', () => {
    const row = personExportRecord({
      id: 'p',
      companyId: 'c',
      companyName: 'Acme',
      email: 'person@example.com',
      hidden: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-09-01',
      firstInteraction: '2025-01-01',
      lastInteraction: '2026-08-01',
    });
    expect(row.lastInteraction).toBe('2026-08-01');
    expect(row.firstInteraction).toBe('2025-01-01');
  });
});
