import { describe, expect, test } from 'vitest';
import {
  blockNameToItemType,
  type ItemType,
  itemTypeToReferenceEntityType,
  stringToItemType,
} from './itemType';

describe('itemTypeToReferenceEntityType', () => {
  test('agent block, history, and reference spellings agree', () => {
    expect(blockNameToItemType('agent')).toBe('agent_session');
    expect(stringToItemType('agent_session')).toBe('agent_session');
    expect(itemTypeToReferenceEntityType('agent_session')).toBe(
      'agent_session'
    );
  });
  test('maps email to the thread type used by referencium', () => {
    expect(itemTypeToReferenceEntityType('email')).toBe('thread');
  });
  test('preserves the routine reference wire contract', () => {
    expect(itemTypeToReferenceEntityType('routine')).toBe('automation');
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

  test.each(['routine', 'automation'])(
    'reads %s references as routines',
    (raw) => {
      expect(stringToItemType(raw)).toBe('routine');
    }
  );

  test.each(['crm_contact', 'channel_message', 'bogus'])(
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
    ['routine', 'routine'],
    ['company', 'crm_company'],
    ['contact', 'crm_contact'],
    ['pr', 'foreign'],
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
    'routine',
  ] as const satisfies readonly ItemType[])(
    '%s survives store and parse',
    (itemType) => {
      expect(stringToItemType(itemTypeToReferenceEntityType(itemType))).toBe(
        itemType
      );
    }
  );
});
