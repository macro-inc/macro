import { type FieldNode, Kind, print, visit } from 'graphql';
import { describe, expect, it } from 'vitest';
import { CHANNEL_MENTION_EDGE_LIMIT } from '../../../queries/channel/mention-edge';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  SoupDocument,
} from './generated/graphql';

describe('bounded channel unread projection', () => {
  it.each([ChannelListSoupDocument, ChannelListItemFieldsFragmentDoc])(
    'keeps the limited edges aliased in both query and reconciliation',
    (document) => {
      const edges = new Map<string, FieldNode>();
      visit(document, {
        Field(field) {
          if (field.name.value !== 'notifications') return;
          edges.set(field.alias?.value ?? '', field);
        },
      });
      expect([...edges.keys()].sort()).toEqual([
        'unreadMentions',
        'unreadNotifications',
      ]);

      const printed = (alias: string) => {
        const field = edges.get(alias);
        return field ? print(field) : '';
      };
      const limit = (alias: string) =>
        edges
          .get(alias)
          ?.arguments?.find((argument) => argument.name.value === 'limit')
          ?.value;

      expect(limit('unreadNotifications')).toMatchObject({
        kind: Kind.INT,
        value: '1',
      });
      expect(printed('unreadNotifications')).toContain('states: [UNSEEN]');
      expect(printed('unreadNotifications')).toContain(
        'topLevelMessagesOnly: true'
      );
      expect(printed('unreadNotifications')).not.toContain('metadata');

      // Thread mentions count too, so the mention edge has no top-level filter.
      expect(limit('unreadMentions')).toMatchObject({
        kind: Kind.INT,
        value: String(CHANNEL_MENTION_EDGE_LIMIT),
      });
      expect(printed('unreadMentions')).toContain('states: [UNSEEN]');
      expect(printed('unreadMentions')).toContain(
        'eventTypes: ["channel_mention"]'
      );
      expect(printed('unreadMentions')).not.toContain('topLevelMessagesOnly');
      expect(
        edges
          .get('unreadMentions')
          ?.selectionSet?.selections.map((selection) =>
            selection.kind === Kind.FIELD
              ? selection.name.value
              : selection.kind
          )
      ).toEqual(['id', 'state']);
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
        expect(print(field)).toContain('topLevelMessagesOnly: true');
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
