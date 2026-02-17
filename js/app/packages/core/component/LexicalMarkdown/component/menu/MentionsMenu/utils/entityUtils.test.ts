import { describe, it, expect } from 'vitest';
import { getMentionItemName } from './entityUtils';
import type { MentionItem } from '../../../../utils/mentionsUtils';

describe('getMentionItemName', () => {
  describe('user items', () => {
    it('returns email when name equals email', () => {
      const item = {
        kind: 'user',
        id: 'user-1',
        bucket: 'person',
        searchText: 'test@example.com',
        sortTimestamp: 0,
        timestamps: {},
        data: {
          id: 'user-1',
          email: 'test@example.com',
          name: 'test@example.com',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('test@example.com');
    });

    it('returns name | email when name differs from email', () => {
      const item = {
        kind: 'user',
        id: 'user-1',
        bucket: 'person',
        searchText: 'John Doe test@example.com',
        sortTimestamp: 0,
        timestamps: {},
        data: {
          id: 'user-1',
          email: 'test@example.com',
          name: 'John Doe',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('John Doe | test@example.com');
    });
  });

  describe('group items', () => {
    it('returns @groupAlias format', () => {
      const item = {
        kind: 'group',
        id: 'here',
        data: {
          id: 'here',
          groupAlias: 'here',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('@here');
    });

    it('handles different group aliases', () => {
      const item = {
        kind: 'group',
        id: 'channel',
        data: {
          id: 'channel',
          groupAlias: 'channel',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('@channel');
    });
  });

  describe('date items', () => {
    it('returns the displayText', () => {
      const item = {
        kind: 'date',
        id: 'date-today',
        data: {
          id: 'today',
          type: 'preset',
          displayText: 'Today',
          date: new Date(),
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('Today');
    });

    it('handles complex date display text', () => {
      const item = {
        kind: 'date',
        id: 'date-next-monday',
        data: {
          id: 'next-monday',
          type: 'preset',
          displayText: 'Next Monday (Jan 15)',
          date: new Date(),
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('Next Monday (Jan 15)');
    });
  });

  describe('entity items', () => {
    it('returns entity name when present', () => {
      const item = {
        kind: 'entity',
        id: 'doc-1',
        bucket: 'note',
        searchText: 'My Document',
        sortTimestamp: 0,
        timestamps: {
          updatedAt: null,
          createdAt: null,
        },
        data: {
          id: 'doc-1',
          name: 'My Document',
          type: 'document',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('My Document');
    });

    it('returns "No Subject" for email with null name', () => {
      const item = {
        kind: 'entity',
        id: 'email-1',
        bucket: 'email',
        searchText: '',
        sortTimestamp: 0,
        timestamps: {
          updatedAt: null,
          createdAt: null,
        },
        data: {
          id: 'email-1',
          name: null,
          type: 'email',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('No Subject');
    });

    it('returns empty string for non-email entity with null name', () => {
      const item = {
        kind: 'entity',
        id: 'task-1',
        bucket: 'task',
        searchText: '',
        sortTimestamp: 0,
        timestamps: {
          updatedAt: null,
          createdAt: null,
        },
        data: {
          id: 'task-1',
          name: null,
          type: 'document',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('');
    });

    it('returns entity name for channel items', () => {
      const item = {
        kind: 'entity',
        id: 'channel-1',
        bucket: 'channel',
        searchText: 'General',
        sortTimestamp: 0,
        timestamps: {
          updatedAt: null,
          createdAt: null,
        },
        data: {
          id: 'channel-1',
          name: 'General',
          type: 'channel',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('General');
    });
  });

  describe('command items', () => {
    it('returns searchText when present', () => {
      const item = {
        kind: 'command',
        id: 'cmd-1',
        searchText: '/help',
        sortTimestamp: 0,
        timestamps: {},
        data: {
          id: 'cmd-1',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('/help');
    });

    it('returns empty string when searchText is undefined', () => {
      const item = {
        kind: 'command',
        id: 'cmd-1',
        sortTimestamp: 0,
        timestamps: {},
        data: {
          id: 'cmd-1',
        },
      } as unknown as MentionItem;
      expect(getMentionItemName(item)).toBe('');
    });
  });
});
