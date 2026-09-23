import { Kind, print, visit } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  SoupDocument,
} from './generated/graphql';

describe('bounded channel unread projection', () => {
  it.each([ChannelListSoupDocument, ChannelListItemFieldsFragmentDoc])(
    'keeps the limited edge aliased in both query and reconciliation',
    (document) => {
      let count = 0;
      visit(document, {
        Field(field) {
          if (field.name.value !== 'notifications') return;
          count += 1;
          expect(field.alias?.value).toBe('unreadNotifications');
          expect(
            field.arguments?.find((arg) => arg.name.value === 'limit')?.value
          ).toMatchObject({ kind: Kind.INT, value: '1' });
          expect(print(field)).toContain('states: [UNSEEN]');
          expect(print(field)).toContain('channel_message_reply');
          expect(print(field)).not.toContain('metadata');
        },
      });
      expect(count).toBe(1);
      expect(print(document)).not.toContain('ChannelListNotificationFields');
      expect(print(document)).not.toContain(
        'SoupNotificationNavigationMetadataFields'
      );
      for (const field of [
        'latestMessage',
        'latestNonThreadMessage',
        'mentions',
        'content',
      ]) {
        expect(print(document)).toContain(field);
      }
    }
  );

  it('uses only IDs and bounded unread states for the sidebar badge', () => {
    const fields: string[] = [];
    visit(ChannelUnreadPresenceDocument, {
      Field(field) {
        fields.push(field.name.value);
        if (field.name.value !== 'notifications') return;
        expect(field.alias?.value).toBe('unreadNotifications');
        expect(print(field)).toContain('limit: 1');
        expect(print(field)).toContain('states: [UNSEEN]');
        expect(print(field)).toContain('channel_message_reply');
      },
    });
    expect(new Set(fields)).toEqual(
      new Set([
        'user',
        'soup',
        'items',
        '__typename',
        'id',
        'notifications',
        'state',
      ])
    );
    expect(fields.filter((field) => field === 'notifications')).toHaveLength(1);
  });

  it('leaves full notification reads unbounded and unfiltered', () => {
    visit(SoupDocument, {
      Field(field) {
        if (field.name.value !== 'notifications') return;
        expect(field.alias).toBeUndefined();
        expect(field.arguments ?? []).toHaveLength(0);
      },
    });
    expect(print(SoupDocument)).toContain('SoupNotificationFields');
  });
});
