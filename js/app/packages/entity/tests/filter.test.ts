import { describe, expect, it } from 'vitest';
import type { EntityData } from '../src/types/entity';
import type { WithNotification } from '../src/types/notification';
import { unreadFilterFn } from '../src/utils/filter';

describe('unreadFilterFn', () => {
  describe('email entities', () => {
    it('returns true for unread emails', () => {
      const entity: WithNotification<EntityData> = {
        type: 'email',
        isRead: false,
      } as any;

      expect(unreadFilterFn(entity)).toBe(true);
    });

    it('returns false for read emails', () => {
      const entity: WithNotification<EntityData> = {
        type: 'email',
        isRead: true,
      } as any;

      expect(unreadFilterFn(entity)).toBe(false);
    });
  });

  describe('non-email entities with notifications', () => {
    it('returns true when entity has unviewed notifications', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => [
          { viewedAt: null } as any,
          { viewedAt: 1234567890 } as any,
        ],
      } as any;

      expect(unreadFilterFn(entity)).toBe(true);
    });

    it('returns false when all notifications are viewed', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => [
          { viewedAt: 1234567890 } as any,
          { viewedAt: 9876543210 } as any,
        ],
      } as any;

      expect(unreadFilterFn(entity)).toBe(false);
    });

    it('returns false when notifications array is empty', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => [],
      } as any;

      expect(unreadFilterFn(entity)).toBe(false);
    });

    it('returns false when notifications function returns undefined', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => undefined,
      } as any;

      expect(unreadFilterFn(entity)).toBe(false);
    });

    it('returns false when notifications function returns null', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => null,
      } as any;

      expect(unreadFilterFn(entity)).toBe(false);
    });

    it('returns false when notifications property is undefined', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
      } as any;

      expect(unreadFilterFn(entity)).toBe(false);
    });
  });

  describe('mixed scenarios', () => {
    it('handles entity with multiple unviewed notifications', () => {
      const entity: WithNotification<EntityData> = {
        type: 'channel',
        notifications: () => [
          { viewedAt: null } as any,
          { viewedAt: null } as any,
          { viewedAt: null } as any,
        ],
      } as any;

      expect(unreadFilterFn(entity)).toBe(true);
    });

    it('handles entity with one unviewed among many viewed', () => {
      const entity: WithNotification<EntityData> = {
        type: 'channel',
        notifications: () => [
          { viewedAt: 1234567890 } as any,
          { viewedAt: 1234567890 } as any,
          { viewedAt: null } as any,
          { viewedAt: 1234567890 } as any,
        ],
      } as any;

      expect(unreadFilterFn(entity)).toBe(true);
    });

    it('handles different entity types correctly', () => {
      const documentEntity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => [{ viewedAt: null } as any],
      } as any;

      const channelEntity: WithNotification<EntityData> = {
        type: 'channel',
        notifications: () => [{ viewedAt: null } as any],
      } as any;

      expect(unreadFilterFn(documentEntity)).toBe(true);
      expect(unreadFilterFn(channelEntity)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles notifications with viewedAt as 0', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => [{ viewedAt: 0 } as any],
      } as any;

      // viewedAt: 0 is falsy and treated as unread by the filter
      expect(unreadFilterFn(entity)).toBe(true);
    });

    it('handles notifications with undefined viewedAt', () => {
      const entity: WithNotification<EntityData> = {
        type: 'document',
        notifications: () => [{ viewedAt: undefined } as any],
      } as any;

      expect(unreadFilterFn(entity)).toBe(true);
    });

    it('handles email type even with notifications property present', () => {
      const entity: WithNotification<EntityData> = {
        type: 'email',
        isRead: false,
        notifications: () => [{ viewedAt: 1234567890 } as any],
      } as any;

      // For email type, should only check isRead
      expect(unreadFilterFn(entity)).toBe(true);
    });
  });
});
