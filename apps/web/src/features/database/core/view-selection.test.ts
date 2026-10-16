import { describe, expect, it } from 'vitest';
import { readViewSelection } from './view-selection';

describe('database view selection', () => {
  it('restores the selected table and the view open in each table', () => {
    expect(
      readViewSelection(
        JSON.stringify({ tableId: 'tickets', views: { tickets: 'board' } })
      )
    ).toEqual({ tableId: 'tickets', views: { tickets: 'board' } });
  });

  it('reads an older selection, dropping the drafts it kept', () => {
    expect(
      readViewSelection(
        JSON.stringify({
          tableId: 'tickets',
          views: { tickets: 'board', notes: 7 },
          drafts: { tickets: { view: { layout: 'board' } } },
        })
      )
    ).toEqual({ tableId: 'tickets', views: { tickets: 'board' } });
  });

  it('opens with nothing selected from malformed storage', () => {
    expect(readViewSelection('{')).toBeUndefined();
    expect(readViewSelection('[]')).toBeUndefined();
    expect(readViewSelection(null)).toBeUndefined();
  });
});
