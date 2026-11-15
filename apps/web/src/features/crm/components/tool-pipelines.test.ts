import { FindPipelineEntriesResponse } from '@service-cognition/generated/tools/schemas';
import { describe, expect, it } from 'vitest';
import { entrySummary, formatFieldValue, recordName } from './tool-pipelines';

describe('pipeline tool values', () => {
  it('parses historical entries without currencies and retains new currency metadata', () => {
    const schema =
      FindPipelineEntriesResponse.shape.pipelines.element.shape.entries.element;
    const historical = {
      entryId: '00000000-0000-4000-8000-000000000001',
      record: { id: '00000000-0000-4000-8000-000000000002' },
      fields: { Revenue: 100 },
    };
    expect(schema.safeParse(historical).success).toBe(true);
    expect(
      schema.parse({ ...historical, currencies: { Revenue: 'EUR' } }).currencies
    ).toEqual({ Revenue: 'EUR' });
  });

  it('keeps the denomination with an amount when compact summaries omit its currency column', () => {
    expect(
      entrySummary({
        record: { id: '1' },
        fields: {
          'Contract value': 1234.567,
          Outcome: 'Won',
          Owner: 'me',
          'Revenue currency': 'EUR',
        },
        currencies: { 'Contract value': 'EUR' },
      })
    ).toBe('Contract value: EUR 1,234.567 · Outcome: Won · Owner: me');
    expect(formatFieldValue(100, 'EUR')).toBe('EUR 100');
    expect(formatFieldValue(200, 'USD')).toBe('USD 200');
    expect(formatFieldValue(null, 'EUR')).toBe('empty');
  });
  it('shows people by email and lists joined', () => {
    expect(formatFieldValue('macro|sam@acme.com')).toBe('sam@acme.com');
    expect(formatFieldValue(['macro|a@x.com', 'macro|b@x.com'])).toBe(
      'a@x.com, b@x.com'
    );
    expect(formatFieldValue(null)).toBe('empty');
    expect(formatFieldValue(true)).toBe('true');
  });

  it('does not treat inherited object properties as currency metadata', () => {
    expect(
      entrySummary({
        record: { id: '1' },
        fields: { toString: 25, Revenue: 100 },
        currencies: { Revenue: 'EUR' },
      })
    ).toBe('toString: 25 · Revenue: EUR 100');
  });

  it('names a record by name, then detail, then id', () => {
    expect(recordName({ id: '1', name: 'Acme', detail: 'acme.com' })).toBe(
      'Acme'
    );
    expect(recordName({ id: '1', detail: 'acme.com' })).toBe('acme.com');
    expect(recordName({ id: '1' })).toBe('1');
  });
});
