import type { EmailEntity, EntityData } from '@entity';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  emailEntityIsUnreadSignal,
  soupItemIsUnreadSignal,
} from './unread-presence';

const entity = (overrides: Partial<EmailEntity> = {}): EntityData =>
  ({
    type: 'email',
    id: 'thread',
    name: 'Thread',
    ownerId: 'viewer',
    isRead: false,
    isDraft: false,
    isImportant: true,
    isSignal: true,
    done: false,
    ...overrides,
  }) satisfies EmailEntity;

const item = (
  overrides: Partial<Extract<SoupApiItem, { tag: 'emailThread' }>['data']> = {}
): SoupApiItem => ({
  tag: 'emailThread',
  frecency_score: 0,
  is_favorited: false,
  data: {
    id: 'thread',
    name: 'Thread',
    ownerId: 'viewer',
    createdAt: '2026-09-24T12:00:00Z',
    updatedAt: '2026-09-24T12:00:00Z',
    sortTs: '2026-09-24T12:00:00Z',
    inboxVisible: true,
    isDraft: false,
    isImportant: true,
    isRead: false,
    isSignal: true,
    properties: [],
    attachments: [],
    labels: [],
    participants: [],
    ...overrides,
  },
});

describe('email unread presence membership', () => {
  it('admits an unread Signal thread the viewer owns', () => {
    expect(emailEntityIsUnreadSignal(entity(), 'viewer')).toBe(true);
    expect(soupItemIsUnreadSignal(item(), 'viewer')).toBe(true);
  });

  it('rejects rows the unread query would never return', () => {
    for (const overrides of [
      { isRead: true },
      { done: true },
      { isSignal: false },
      { ownerId: 'colleague' },
    ]) {
      expect(emailEntityIsUnreadSignal(entity(overrides), 'viewer')).toBe(
        false
      );
    }
    for (const overrides of [
      { isRead: true },
      { inboxVisible: false },
      { isSignal: false },
      { ownerId: 'colleague' },
    ]) {
      expect(soupItemIsUnreadSignal(item(overrides), 'viewer')).toBe(false);
    }
  });

  it('ignores entities and items that are not email threads', () => {
    expect(
      emailEntityIsUnreadSignal(
        { type: 'document', id: 'doc', name: 'Doc', ownerId: 'viewer' },
        'viewer'
      )
    ).toBe(false);
    expect(
      soupItemIsUnreadSignal(
        {
          tag: 'document',
          frecency_score: 0,
          data: { id: 'doc' },
        } as unknown as SoupApiItem,
        'viewer'
      )
    ).toBe(false);
  });

  it('keeps an unclassified thread rather than hiding unread mail', () => {
    expect(
      emailEntityIsUnreadSignal(entity({ isSignal: undefined }), 'viewer')
    ).toBe(true);
    expect(emailEntityIsUnreadSignal(entity(), undefined)).toBe(true);
    // The insert gate is the strict side of the pair: an unclassified item
    // waits for the next fetch instead of entering the page.
    expect(
      soupItemIsUnreadSignal(item({ isSignal: undefined }), 'viewer')
    ).toBe(false);
    expect(
      soupItemIsUnreadSignal(item({ ownerId: 'colleague' }), undefined)
    ).toBe(true);
  });
});
