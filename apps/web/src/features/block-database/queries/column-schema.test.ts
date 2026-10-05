import { describe, expect, it } from 'vitest';
import { opColumnKind } from './column-schema';

describe('column kind translation', () => {
  it('qualifies relation targets with the owning database', () => {
    expect(opColumnKind('db', { type: 'relation', table: 'people' })).toEqual({
      type: 'relation',
      database: 'db',
      table: 'people',
    });
  });
});
