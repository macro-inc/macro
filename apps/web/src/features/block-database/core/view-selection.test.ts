import { describe, expect, it } from 'vitest';
import { defaultDatabaseView } from './database-view';
import { readViewSelection } from './view-selection';

describe('database view persistence', () => {
  it('restores the selected table, saved view, and unsaved board arrangement', () => {
    const selection = {
      tableId: 'tickets',
      views: { tickets: 'board' },
      drafts: {
        tickets: {
          selectedViewId: 'board',
          view: {
            ...defaultDatabaseView(),
            layout: 'board',
            groupBy: 'priority',
            groupOrder: ['value:"High"', 'empty'],
          },
        },
      },
    };
    expect(readViewSelection(JSON.stringify(selection))).toEqual(selection);
  });

  it('migrates old selections and ignores malformed drafts without losing valid views', () => {
    expect(
      readViewSelection('{"tableId":"tickets","views":{"tickets":"board"}}')
    ).toEqual({ tableId: 'tickets', views: { tickets: 'board' }, drafts: {} });
    expect(
      readViewSelection(
        '{"drafts":{"bad":{"view":{"layout":"board"}}},"views":{"bad":3,"good":"table"}}'
      )
    ).toEqual({ tableId: undefined, views: { good: 'table' }, drafts: {} });
    for (const raw of ['{bad', 'null', '[]', '4'])
      expect(readViewSelection(raw)).toBeUndefined();
  });
});
