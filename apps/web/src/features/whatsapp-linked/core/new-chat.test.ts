import { describe, expect, it } from 'vitest';
import { chatSections, type WhatsAppChat } from './chat';
import { normalizePhoneNumber } from './new-chat';

describe('normalizePhoneNumber', () => {
  it('accepts international numbers however they are spaced', () => {
    expect(normalizePhoneNumber('+5550001')).toBe('+5550001');
    expect(normalizePhoneNumber(' +555 000 1 ')).toBe('+5550001');
    expect(normalizePhoneNumber('+555-00.01')).toBe('+5550001');
    expect(normalizePhoneNumber('+(555) 0001')).toBe('+5550001');
    expect(normalizePhoneNumber('00 555 0001')).toBe('+5550001');
  });

  it('refuses numbers without a country code or of the wrong length', () => {
    expect(normalizePhoneNumber('555 0001')).toBeUndefined();
    expect(normalizePhoneNumber('+0555001')).toBeUndefined();
    expect(normalizePhoneNumber('+555001')).toBeUndefined();
    expect(normalizePhoneNumber(`+${'1'.repeat(16)}`)).toBeUndefined();
    expect(normalizePhoneNumber('+555 0001 ext 2')).toBeUndefined();
    expect(normalizePhoneNumber('')).toBeUndefined();
  });
});

describe('chatSections', () => {
  const direct = {
    kind: 'direct' as const,
    archived: false,
    inMacro: undefined,
    canAdd: true,
    cannotAddReason: undefined,
  };
  const recent: WhatsAppChat = {
    ...direct,
    jid: 'recent',
    name: 'Ana Ruiz',
    phoneNumber: '+5550001',
    lastActivityAt: '2025-03-07T10:00:00Z',
  };
  const contact: WhatsAppChat = {
    ...direct,
    jid: 'contact',
    name: 'Dana Smith',
    phoneNumber: '+5550002',
    lastActivityAt: undefined,
  };
  const added: WhatsAppChat = {
    ...contact,
    jid: 'added',
    name: 'Eve Adams',
    inMacro: { kind: 'own', chatId: 'chat-eve' },
    canAdd: false,
  };

  it('lists contacts nobody wrote to apart from recent chats', () => {
    const sections = chatSections([recent, contact, added]);
    expect(sections.listed.map((chat) => chat.jid)).toEqual(['recent']);
    expect(sections.contacts.map((chat) => chat.jid)).toEqual(['contact']);
  });

  it('finds a contact by name or by number', () => {
    expect(chatSections([recent, contact], 'dana').contacts).toEqual([contact]);
    expect(chatSections([recent, contact], '555 0002').contacts).toEqual([
      contact,
    ]);
    expect(chatSections([recent, contact], '555 0002').listed).toEqual([]);
  });
});
