import { describe, expect, it } from 'vitest';
import { isEntityDragData } from './drag';

const validDragData = {
  id: 'document-id',
  name: 'Document',
  ownerId: 'owner-id',
  type: 'document',
  dragType: 'entity',
  operation: () => 'move',
} as const;

describe('isEntityDragData', () => {
  it('accepts a complete entity drag payload', () => {
    expect(isEntityDragData(validDragData)).toBe(true);
  });

  it.each(['id', 'name', 'ownerId', 'type', 'operation'] as const)(
    'rejects a payload without %s',
    (field) => {
      const { [field]: _, ...incomplete } = validDragData;
      expect(isEntityDragData(incomplete)).toBe(false);
    }
  );

  it.each([
    ['id', 1],
    ['name', null],
    ['ownerId', false],
    ['type', 'unsupported'],
    ['operation', 'move'],
    ['splitId', 1],
  ] as const)('rejects an invalid %s', (field, value) => {
    expect(isEntityDragData({ ...validDragData, [field]: value })).toBe(false);
  });
});
