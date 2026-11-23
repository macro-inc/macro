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
    ).toBe('send email and edit documents');
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
      'send email, delete email, edit documents, and 2 more things'
    );
  });
});
