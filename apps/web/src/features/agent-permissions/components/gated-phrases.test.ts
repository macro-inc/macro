import { describe, expect, it } from 'vitest';
import {
  DELETE_LABEL,
  EDIT_DOCUMENT,
  RENAME_DOCUMENT,
  SEND_MESSAGE,
} from '../tests/gated-fixtures';
import {
  describeGatedThings,
  describePermissionRun,
  permissionRunTitle,
} from './gated-phrases';

describe('gated phrases', () => {
  it('names one thing', () => {
    expect(describeGatedThings([DELETE_LABEL])).toBe('delete email');
  });

  it('joins things as a list, once per group and action', () => {
    expect(
      describePermissionRun([SEND_MESSAGE, EDIT_DOCUMENT, RENAME_DOCUMENT])
    ).toBe('run a program that may send email and edit documents');
    expect(permissionRunTitle([SEND_MESSAGE])).toBe(
      'Run a program that may send email'
    );
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
    ).toBe('read contacts & CRM and create AI chats & skills');
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
      'delete email, send email, edit documents, and 2 more things'
    );
  });
});
