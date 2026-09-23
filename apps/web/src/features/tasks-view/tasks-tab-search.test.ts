import { describe, expect, it } from 'vitest';
import { tasksTabSearch, tasksTabSearchCodec } from './tasks-tab-search';

describe('Tasks tab search', () => {
  it('omits the default tab and round-trips other tabs', () => {
    expect(tasksTabSearchCodec.serialize({ tab: 'my-tasks' })).toBeUndefined();
    for (const tab of ['created-by-me', 'team-tasks'] as const) {
      expect(tasksTabSearchCodec.serialize({ tab })).toEqual({ tab: [tab] });
      expect(tasksTabSearchCodec.parse({ tab: [tab] }).value.tab).toBe(tab);
    }
    expect(tasksTabSearch.namespace).toBe('tasks');
  });

  it('rejects invalid tabs and restores the default', () => {
    expect(tasksTabSearchCodec.parse({ tab: ['unknown'] })).toEqual({
      value: { tab: 'my-tasks' },
      valid: false,
    });
  });
});
