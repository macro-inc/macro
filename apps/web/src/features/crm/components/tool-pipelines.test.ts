import { describe, expect, it } from 'vitest';
import { formatFieldValue, recordName } from './tool-pipelines';

describe('pipeline tool values', () => {
  it('shows people by email and lists joined', () => {
    expect(formatFieldValue('macro|sam@acme.com')).toBe('sam@acme.com');
    expect(formatFieldValue(['macro|a@x.com', 'macro|b@x.com'])).toBe(
      'a@x.com, b@x.com'
    );
    expect(formatFieldValue(null)).toBe('empty');
    expect(formatFieldValue(true)).toBe('true');
  });

  it('names a record by name, then detail, then id', () => {
    expect(recordName({ id: '1', name: 'Acme', detail: 'acme.com' })).toBe(
      'Acme'
    );
    expect(recordName({ id: '1', detail: 'acme.com' })).toBe('acme.com');
    expect(recordName({ id: '1' })).toBe('1');
  });
});
