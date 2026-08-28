import { describe, expect, test } from 'vitest';
import { type ItemType, itemTypeToReferenceEntityType } from './itemType';

describe('itemTypeToReferenceEntityType', () => {
  test('maps email to the thread type used by referencium', () => {
    expect(itemTypeToReferenceEntityType('email')).toBe('thread');
  });

  test.each([
    'document',
    'chat',
    'project',
    'channel',
    'call',
    'calendar_event',
  ] as const satisfies readonly ItemType[])(
    'leaves %s unchanged',
    (itemType) => {
      expect(itemTypeToReferenceEntityType(itemType)).toBe(itemType);
    }
  );
});
