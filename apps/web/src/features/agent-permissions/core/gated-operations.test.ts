import { describe, expect, it } from 'vitest';
import {
  DELETE_LABEL,
  EDIT_DOCUMENT,
  RENAME_DOCUMENT,
  SEND_MESSAGE,
} from '../tests/gated-fixtures';
import {
  gatedFocus,
  gatedThings,
  groupGatedOperations,
} from './gated-operations';

describe('groupGatedOperations', () => {
  it('keeps the server order of groups and sorts each by action, then label', () => {
    const groups = groupGatedOperations([
      SEND_MESSAGE,
      RENAME_DOCUMENT,
      DELETE_LABEL,
      EDIT_DOCUMENT,
    ]);
    expect(groups.map((group) => group.group)).toEqual(['email', 'documents']);
    expect(groups[0].operations.map((op) => op.operation)).toEqual([
      'send_message',
      'delete_label',
    ]);
    expect(groups[1].operations.map((op) => op.operation)).toEqual([
      'edit_document',
      'rename_document',
    ]);
  });

  it('puts an unclassified operation last in its group', () => {
    const unclassified = { ...SEND_MESSAGE, operation: 'x', action: null };
    const [group] = groupGatedOperations([unclassified, DELETE_LABEL]);
    expect(group.operations.map((op) => op.operation)).toEqual([
      'delete_label',
      'x',
    ]);
  });
});

describe('gatedThings', () => {
  it('says each action of each group once, however many tools it covers', () => {
    expect(gatedThings([SEND_MESSAGE, EDIT_DOCUMENT, RENAME_DOCUMENT])).toEqual(
      [
        { action: 'send', groupName: 'Email' },
        { action: 'update', groupName: 'Documents' },
      ]
    );
  });
});

describe('gatedFocus', () => {
  it('lands on the first operation’s group action', () => {
    expect(gatedFocus([SEND_MESSAGE])).toEqual({
      group: 'email',
      action: 'send',
      tool: undefined,
    });
  });

  it('lands on the tool itself when its own setting refused it', () => {
    expect(gatedFocus([EDIT_DOCUMENT])).toEqual({
      group: 'documents',
      action: 'update',
      tool: { service: 'documents', operation: 'edit_document' },
    });
  });

  it('has nowhere to land without operations', () => {
    expect(gatedFocus([])).toBeUndefined();
  });
});
