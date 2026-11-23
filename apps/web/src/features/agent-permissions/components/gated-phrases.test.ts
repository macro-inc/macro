import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PermissionAction } from '@service-agent-harness/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  DELETE_LABEL,
  EDIT_DOCUMENT,
  RENAME_DOCUMENT,
  SEND_MESSAGE,
} from '../tests/gated-fixtures';
import {
  describeGatedThings,
  gatedThingsTitle,
  permissionRequestParts,
} from './gated-phrases';

describe('gated phrases', () => {
  it('names one thing', () => {
    expect(describeGatedThings([DELETE_LABEL])).toBe('delete email');
  });

  it('joins things as a list, once per group and action', () => {
    expect(
      describeGatedThings([SEND_MESSAGE, EDIT_DOCUMENT, RENAME_DOCUMENT])
    ).toBe('send email and edit documents and projects');
    expect(gatedThingsTitle([SEND_MESSAGE])).toBe('Send email');
    expect(gatedThingsTitle([])).toBe('Run a program');
  });

  it('asks with the agent plain and each action and entity accented', () => {
    expect(
      permissionRequestParts('Scout', [SEND_MESSAGE, EDIT_DOCUMENT])
    ).toEqual([
      { text: 'Allow ', accent: false },
      { text: 'Scout', accent: false },
      { text: ' to ', accent: false },
      { text: 'send', accent: true },
      { text: ' ', accent: false },
      { text: 'email', accent: true },
      { text: ' and ', accent: false },
      { text: 'edit', accent: true },
      { text: ' ', accent: false },
      { text: 'documents', accent: true },
      { text: ' and ', accent: false },
      { text: 'projects', accent: true },
      { text: '?', accent: false },
    ]);
  });

  it('never reads marks in the agent’s name', () => {
    const parts = permissionRequestParts('<em>Scout</em>', [SEND_MESSAGE]);
    expect(parts[1]).toEqual({ text: '<em>Scout</em>', accent: false });
  });

  it('still asks when it can’t read the operations', () => {
    expect(permissionRequestParts('Scout', [])).toEqual([
      { text: 'Allow Scout to run a program?', accent: false },
    ]);
  });

  it('keeps acronyms in group names', () => {
    expect(
      describeGatedThings([
        {
          ...SEND_MESSAGE,
          group: 'contacts',
          groupName: 'Contacts & CRM',
          action: 'read' as const,
        },
        {
          ...SEND_MESSAGE,
          group: 'ai',
          groupName: 'AI chats & skills',
          action: 'create' as const,
        },
      ])
    ).toBe('read contacts in your CRM and create AI chats and skills');
  });

  it('names three things and counts the rest', () => {
    const things = [
      DELETE_LABEL,
      SEND_MESSAGE,
      EDIT_DOCUMENT,
      {
        ...SEND_MESSAGE,
        group: 'tasks',
        groupName: 'Tasks',
        action: 'create' as const,
      },
      { ...SEND_MESSAGE, group: 'calendar', groupName: 'Calendar' },
    ];
    expect(describeGatedThings(things)).toBe(
      'send and delete email, edit documents and projects, create tasks, and 1 more thing'
    );
  });

  it('says many actions on one entity once', () => {
    const task = (action: PermissionAction) => ({
      ...SEND_MESSAGE,
      operation: action,
      group: 'tasks',
      groupName: 'Tasks',
      action,
    });
    expect(
      describeGatedThings([task('create'), task('update'), task('destroy')])
    ).toBe('create, edit, and delete tasks');
  });

  it('names an entity this build doesn’t know by its name', () => {
    expect(
      describeGatedThings([
        { ...SEND_MESSAGE, group: 'new_things', groupName: 'New things' },
      ])
    ).toBe('send new things');
  });

  it('covers every entity and action some tool has', () => {
    const registry = JSON.parse(
      // Tests run from apps/web.
      readFileSync(
        resolve(
          process.cwd(),
          '../../crates/agent_permission_registry/registry.json'
        ),
        'utf8'
      )
    ) as {
      operations: Record<
        string,
        Record<string, { group: string; action?: string | null }>
      >;
    };
    const pairs = new Set<string>();
    for (const operations of Object.values(registry.operations)) {
      for (const operation of Object.values(operations)) {
        pairs.add(`${operation.group}.${operation.action}`);
      }
    }
    expect([...pairs].sort()).toEqual(Object.keys(PHRASES).sort());
  });

  // Every entity and action some tool has (registry.json), as the request
  // card says it: each one names its entity and accents a verb and a noun.
  it.each(Object.entries(PHRASES))('says %s as people do', (pair, phrase) => {
    const [group, action] = pair.split('.') as [string, PermissionAction];
    const operation = { ...SEND_MESSAGE, group, groupName: group, action };
    expect(describeGatedThings([operation])).toBe(phrase);
    const accented = permissionRequestParts('Scout', [operation]).filter(
      (part) => part.accent
    );
    expect(accented.length).toBeGreaterThanOrEqual(2);
  });
});

const PHRASES: Record<string, string> = {
  'documents.read': 'read documents and projects',
  'documents.create': 'create documents and projects',
  'documents.update': 'edit documents and projects',
  'documents.send': 'comment on documents',
  'documents.destroy': 'delete documents and projects',
  'tasks.read': 'read tasks',
  'tasks.create': 'create tasks',
  'tasks.update': 'edit tasks',
  'tasks.destroy': 'delete tasks',
  'email.read': 'read email',
  'email.create': 'draft email',
  'email.update': 'edit email',
  'email.send': 'send email',
  'email.destroy': 'delete email',
  'calendar.read': 'read calendar events',
  'calendar.create': 'create calendar events',
  'calendar.update': 'edit calendar events',
  'calendar.send': 'send calendar invitations',
  'calendar.destroy': 'delete calendar events',
  'channels.read': 'read messages in channels',
  'channels.create': 'start conversations',
  'channels.update': 'edit messages in channels',
  'channels.send': 'send messages in channels',
  'channels.destroy': 'delete messages in channels',
  'channel_admin.read': 'read channel settings and members',
  'channel_admin.update': 'edit channel settings and members',
  'channel_admin.send': 'change channels and who is in them',
  'channel_admin.destroy': 'delete channels',
  'calls.read': 'read calls and meetings',
  'calls.update': 'edit calls and meetings',
  'calls.send': 'join or schedule calls and meetings',
  'calls.destroy': 'delete calls and meetings',
  'external_chats.read': 'read outside chats',
  'external_chats.create': 'create outside chats',
  'external_chats.update': 'edit outside chats',
  'external_chats.send': 'send messages in outside chats',
  'external_chats.destroy': 'delete outside chats',
  'contacts.read': 'read contacts in your CRM',
  'contacts.create': 'create contacts in your CRM',
  'contacts.update': 'edit contacts in your CRM',
  'contacts.destroy': 'delete contacts in your CRM',
  'databases.read': 'read databases and forms',
  'databases.create': 'create databases and forms',
  'databases.update': 'edit databases and forms',
  'databases.destroy': 'delete databases and forms',
  'routines.read': 'read routines and reminders',
  'routines.create': 'create routines and reminders',
  'routines.update': 'edit routines and reminders',
  'routines.send': 'share routine templates',
  'routines.destroy': 'delete routines and reminders',
  'ai.read': 'read AI chats and skills',
  'ai.create': 'create AI chats and skills',
  'ai.update': 'edit AI chats and skills',
  'ai.send': 'search the web',
  'ai.destroy': 'delete AI chats and skills',
  'agents.read': 'read agent sessions',
  'agents.create': 'create agent sessions',
  'agents.update': 'edit agent sessions',
  'agents.destroy': 'delete agent sessions',
  'connections.read': 'read connected apps and imports',
  'connections.create': 'create connected apps and imports',
  'connections.update': 'edit connected apps and imports',
  'connections.send': 'use connected apps',
  'connections.destroy': 'delete connected apps and imports',
  'sharing.read': 'see who has access to your items',
  'sharing.update': 'cancel access requests',
  'sharing.send': 'change who has access to your items',
  'search.read': 'search your workspace',
  'search.create': 'add favorites and pins',
  'search.update': 'change favorites and pins',
  'search.send': 'preview links',
  'notifications.read': 'read notifications',
  'notifications.update': 'edit notifications',
  'notifications.send': 'send notifications',
  'notifications.destroy': 'delete notifications',
  'passwords.read': 'read passwords and API keys',
  'passwords.create': 'create passwords and API keys',
  'passwords.destroy': 'delete passwords and API keys',
  'account.read': 'read your profile and team',
  'account.create': 'upload a profile picture',
  'account.update': 'edit your profile and team',
  'account.send': 'invite people to your team',
  'account.destroy': 'delete team invites',
};
