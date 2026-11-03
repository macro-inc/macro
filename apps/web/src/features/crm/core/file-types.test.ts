import { describe, expect, it } from 'vitest';
import { groupFilesByType } from './file-types';

describe('record file classification', () => {
  it('uses the source document value across records and keeps unknown values distinct', () => {
    const shared = { id: 'shared' };
    const labels = {
      unclassified: 'Unclassified',
      unavailable: 'Type unavailable',
    };
    const options = [
      { id: 'invoice', name: 'Invoice' },
      { id: 'contract', name: 'Contract' },
    ];
    const values = new Map([
      ['shared', 'invoice'],
      ['untyped', null],
      ['deleted-option', 'old'],
    ]);
    const first = groupFilesByType(
      [shared, { id: 'untyped' }, { id: 'private' }, { id: 'deleted-option' }],
      options,
      values,
      labels
    );
    expect(first).toEqual([
      { id: 'invoice', name: 'Invoice', files: [shared] },
      { id: 'untyped', name: 'Unclassified', files: [{ id: 'untyped' }] },
      {
        id: 'unavailable',
        name: 'Type unavailable',
        files: [{ id: 'private' }, { id: 'deleted-option' }],
      },
    ]);
    expect(groupFilesByType([shared], options, values, labels)[0]?.id).toBe(
      'invoice'
    );
    values.set('shared', 'contract');
    expect(groupFilesByType([shared], options, values, labels)[0]?.id).toBe(
      'contract'
    );
  });
});
