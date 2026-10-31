import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import {
  newTimelineWithTimeRangeColumn,
  timelineWithTimeRangeColumn,
  timeRangeColumnName,
} from './timeline-range';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};

describe('a timeline along a new Time range column', () => {
  it('creates the column and the timeline in one batch, under the ids minted for them', () => {
    expect(
      newTimelineWithTimeRangeColumn({
        tableId: 'tasks',
        viewId: 'timeline',
        name: 'Timeline view',
        query: { filter: null, sort: [] },
        columns: [name],
        column: 'dates',
      })
    ).toEqual([
      {
        kind: 'column',
        table: 'tasks',
        column: 'dates',
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Time range',
            type: { type: 'date_range' },
          },
        },
      },
      {
        kind: 'view',
        table: 'tasks',
        view: 'timeline',
        change: {
          kind: 'create',
          view: {
            name: 'Timeline view',
            query: { filter: null, sort: [] },
            layout: {
              kind: 'timeline',
              range: 'dates',
              title: 'name',
              groupBy: null,
              barFields: [],
              colorBy: null,
            },
          },
        },
      },
    ]);
  });

  it('lays an existing view out along the new column', () => {
    expect(
      timelineWithTimeRangeColumn({
        view: {
          id: 'view',
          databaseId: 'database',
          tableId: 'tasks',
          name: 'Table view',
          position: 'a0',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
        },
        columns: [name, { ...name, id: 'dates-column', name: 'Time range' }],
        column: 'dates',
      })
    ).toEqual([
      {
        kind: 'column',
        table: 'tasks',
        column: 'dates',
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Time range 2',
            type: { type: 'date_range' },
          },
        },
      },
      {
        kind: 'view',
        table: 'tasks',
        view: 'view',
        change: {
          kind: 'update',
          layout: {
            kind: 'timeline',
            range: 'dates',
            title: 'name',
            groupBy: null,
            barFields: [],
            colorBy: null,
          },
        },
      },
    ]);
  });

  it('takes the first free Time range name, ignoring case', () => {
    expect(timeRangeColumnName([name])).toBe('Time range');
    expect(
      timeRangeColumnName([
        { ...name, name: 'time range' },
        { ...name, name: 'Time range 2' },
      ])
    ).toBe('Time range 3');
  });
});
