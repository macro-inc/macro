import { describe, expect, test } from 'vitest';
import { getListViewCreateActionId } from './list-view-create';

describe('getListViewCreateActionId', () => {
  test.each([
    ['agents', 'agent'],
    ['mail', 'email'],
    ['documents', 'doc'],
    ['tasks', 'task'],
    ['channels', 'message'],
    ['files', 'folder'],
  ] as const)('maps %s to %s', (view, actionId) => {
    expect(getListViewCreateActionId(view)).toBe(actionId);
  });

  test('does not expose create actions for aggregate views', () => {
    expect(getListViewCreateActionId('inbox')).toBeUndefined();
    expect(getListViewCreateActionId('search')).toBeUndefined();
  });
});
