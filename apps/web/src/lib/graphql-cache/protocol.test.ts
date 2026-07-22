import { describe, expect, it } from 'vitest';
import {
  MAX_RECORD_SELECTION_PAGE_SIZE,
  validateRecordSelectionLimit,
} from './protocol';

describe('validateRecordSelectionLimit', () => {
  it('accepts bounded positive integers', () => {
    expect(validateRecordSelectionLimit(1)).toBe(1);
    expect(validateRecordSelectionLimit(MAX_RECORD_SELECTION_PAGE_SIZE)).toBe(
      MAX_RECORD_SELECTION_PAGE_SIZE
    );
  });

  it.each([
    0,
    -1,
    1.5,
    MAX_RECORD_SELECTION_PAGE_SIZE + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid limit %s', (limit) => {
    expect(() => validateRecordSelectionLimit(limit)).toThrow(
      'record selection limit must be an integer between 1 and 500'
    );
  });
});
