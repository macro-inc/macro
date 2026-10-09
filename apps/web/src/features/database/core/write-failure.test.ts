import { describe, expect, it } from 'vitest';
import { databaseEntityMessage } from './write-failure';

describe('database entity message', () => {
  it('names a forbidden or missing database instead of echoing the service', () => {
    expect(
      databaseEntityMessage(
        { kind: 'refused', errorCode: 'FORBIDDEN', message: 'forbidden' },
        'delete'
      )
    ).toBe('You can’t delete this database.');
    expect(
      databaseEntityMessage(
        { kind: 'refused', errorCode: 'NOT_FOUND', message: 'not found' },
        'rename'
      )
    ).toBe('This database is no longer available.');
    expect(
      databaseEntityMessage(
        {
          kind: 'refused',
          errorCode: 'INVALID_INPUT',
          message: 'Name is too long',
        },
        'rename'
      )
    ).toBe('Name is too long');
  });
});
