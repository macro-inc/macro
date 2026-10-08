import { type FieldNode, Kind, print, visit } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  SoupDocument,
} from './generated/graphql';

const unreadWitnessAliases = [
  'unreadNotifications',
  'unreadChannelActivity',
  'unreadChannelImportant',
];

function expectBoundedUnreadWitness(field: FieldNode) {
  const alias = field.alias?.value;
  expect(unreadWitnessAliases).toContain(alias);
  expect(
    field.arguments?.find((arg) => arg.name.value === 'limit')?.value
  ).toMatchObject({ kind: Kind.INT, value: '1' });
  const selection = print(field);
  expect(selection).toContain('states: [UNSEEN]');
  expect(selection).not.toContain('metadata');
  if (alias === 'unreadNotifications') {
    expect(selection).toContain('topLevelMessagesOnly: true');
  } else {
    expect(selection).not.toContain('topLevelMessagesOnly');
    expect(selection).toContain('eventType');
  }
  if (alias === 'unreadChannelImportant') {
    expect(selection).toContain(
      'eventTypes: ["channel_mention", "channel_message_reply"]'
    );
  } else {
    expect(selection).not.toContain('eventTypes:');
  }
}

describe('bounded channel unread projection', () => {
  it.each([ChannelListSoupDocument, ChannelListItemFieldsFragmentDoc])(
    'keeps each limited witness aliased in both query and reconciliation',
    (document) => {
      const aliases: string[] = [];
      visit(document, {
        Field(field) {
          if (field.name.value !== 'notifications') return;
          aliases.push(field.alias?.value ?? '');
          expectBoundedUnreadWitness(field);
        },
      });
      expect(aliases).toEqual(unreadWitnessAliases);
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

  it('uses only IDs and bounded unread witnesses for the sidebar badge', () => {
    const fields: string[] = [];
    const aliases: string[] = [];
    visit(ChannelUnreadPresenceDocument, {
      Field(field) {
        fields.push(field.name.value);
        if (field.name.value !== 'notifications') return;
        aliases.push(field.alias?.value ?? '');
        expectBoundedUnreadWitness(field);
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
        'eventType',
      ])
    );
    expect(aliases).toEqual(unreadWitnessAliases);
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
