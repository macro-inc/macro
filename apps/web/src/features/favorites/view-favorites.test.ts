import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { describe, expect, it } from 'vitest';
import { favoriteMatchesView } from './favorite-matches-view';

const favorite = (
  entityType: Favorite['entityType'],
  documentSubType?: Favorite['documentSubType']
): Favorite => ({
  entityType,
  documentSubType,
  entityId: 'example',
  createdAt: '',
  sortOrder: 0,
});

describe('favoriteMatchesView', () => {
  it('separates tasks from files', () => {
    expect(favoriteMatchesView(favorite('document', 'task'), 'tasks')).toBe(
      true
    );
    expect(favoriteMatchesView(favorite('document', 'task'), 'documents')).toBe(
      false
    );
    expect(favoriteMatchesView(favorite('document'), 'documents')).toBe(true);
    expect(favoriteMatchesView(favorite('document'), 'tasks')).toBe(false);
  });
  it('keeps email, conversations, and agents in their own views', () => {
    expect(favoriteMatchesView(favorite('email_thread'), 'mail')).toBe(true);
    expect(favoriteMatchesView(favorite('channel'), 'mail')).toBe(false);
    expect(favoriteMatchesView(favorite('channel_message'), 'channels')).toBe(
      true
    );
    expect(favoriteMatchesView(favorite('chat'), 'channels')).toBe(false);
    expect(favoriteMatchesView(favorite('chat'), 'agents')).toBe(true);
  });
  it('aggregates inbox favorites and scopes other views', () => {
    expect(favoriteMatchesView(favorite('email_thread'), 'inbox')).toBe(true);
    expect(favoriteMatchesView(favorite('project'), 'folders')).toBe(true);
    expect(favoriteMatchesView(favorite('calendar_event'), 'calendar')).toBe(
      true
    );
    expect(favoriteMatchesView(favorite('crm_company'), 'companies')).toBe(
      true
    );
    expect(favoriteMatchesView(favorite('document'), 'companies')).toBe(false);
  });
});
