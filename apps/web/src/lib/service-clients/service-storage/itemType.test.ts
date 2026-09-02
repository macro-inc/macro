import { describe, expect, test } from 'vitest';
import {
  blockNameToItemType,
  type ItemType,
  itemTypeToReferenceEntityType,
  stringToItemType,
} from './itemType';

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

describe('stringToItemType', () => {
  test.each(['email', 'thread', 'email_thread'])(
    'parses the stored thread spelling %s as email',
    (raw) => {
      expect(stringToItemType(raw)).toBe('email');
    }
  );

  test.each([
    'call',
    'calendar_event',
    'chat',
    'document',
    'project',
    'channel',
    'crm_company',
  ])('parses %s as itself', (raw) => {
    expect(stringToItemType(raw)).toBe(raw);
  });

  test.each(['crm_contact', 'automation', 'channel_message', 'bogus'])(
    'rejects %s',
    (raw) => {
      expect(stringToItemType(raw)).toBeUndefined();
    }
  );
});

describe('blockNameToItemType', () => {
  test.each([
    ['chat', 'chat'],
    ['call', 'call'],
    ['calendar', 'calendar_event'],
    ['channel', 'channel'],
    ['project', 'project'],
    ['email', 'email'],
    ['automation', 'automation'],
    ['company', 'crm_company'],
    ['contact', 'crm_contact'],
  ] as const)('maps block %s to item type %s', (blockName, itemType) => {
    expect(blockNameToItemType(blockName)).toBe(itemType);
  });

  test('maps document blocks to document', () => {
    expect(blockNameToItemType('md')).toBe('document');
    expect(blockNameToItemType('pdf')).toBe('document');
  });
});

describe('reference entity type round trip', () => {
  test.each([
    'document',
    'chat',
    'project',
    'channel',
    'call',
    'calendar_event',
    'crm_company',
    'email',
  ] as const satisfies readonly ItemType[])(
    '%s survives store and parse',
    (itemType) => {
      expect(stringToItemType(itemTypeToReferenceEntityType(itemType))).toBe(
        itemType
      );
    }
  );
});
