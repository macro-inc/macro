import { describe, expect, it } from 'vitest';
import { defaultDatabaseView } from './database-view';
import {
  clearSavedViewDraft,
  type DatabaseViewSelection,
  readViewSelection,
} from './view-selection';

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
            cardOrder: {
              'value:"High"': ['second', 'first'],
              empty: ['third'],
            },
          },
        },
      },
    };
    expect(readViewSelection(JSON.stringify(selection))).toEqual(selection);
  });

  it('clears only the acknowledged view draft, leaving newer order or filters intact', () => {
    const saved = {
      ...defaultDatabaseView(),
      cardOrder: { empty: ['second', 'first'] },
    };
    const selection: DatabaseViewSelection = {
      tableId: 'tickets',
      views: { tickets: 'board' },
      drafts: { tickets: { selectedViewId: 'board', view: saved } },
    };
    expect(clearSavedViewDraft(selection, 'tickets', 'board', saved)).toEqual({
      ...selection,
      drafts: {},
    });
    expect(
      clearSavedViewDraft(selection, 'tickets', 'other-board', saved)
    ).toBe(selection);
    expect(
      clearSavedViewDraft(selection, 'tickets', 'board', {
        ...saved,
        cardOrder: { empty: ['first', 'second'] },
      })
    ).toBe(selection);
    expect(
      clearSavedViewDraft(selection, 'tickets', 'board', {
        ...saved,
        search: 'unsaved search',
      })
    ).toBe(selection);
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
