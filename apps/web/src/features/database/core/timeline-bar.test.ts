import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import {
  timelineBarColor,
  timelineBarFieldColumns,
  timelineBarFields,
  timelineBarTime,
  timelineColorColumn,
  timelineColorColumns,
} from './timeline-bar';

const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const dates: DatabaseViewColumn = {
  id: 'dates',
  name: 'Dates',
  dataType: 'DATE_RANGE',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const stage: DatabaseViewColumn = {
  id: 'stage',
  name: 'Stage',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  options: [
    { id: 'plan', label: 'Plan', color: '#0091FF' },
    { id: 'build', label: 'Build', color: null },
  ],
  writable: true,
};
const labels: DatabaseViewColumn = {
  id: 'labels',
  name: 'Labels',
  dataType: 'TAG',
  isMultiSelect: true,
  options: [
    { id: 'urgent', label: 'Urgent', color: '#E5484D' },
    { id: 'design', label: 'Design', color: '#8E4EC6' },
    { id: 'web', label: 'Web', color: '#46A758' },
  ],
  writable: true,
};
const owner: DatabaseViewColumn = {
  id: 'owner',
  name: 'Owner',
  dataType: 'ENTITY',
  isMultiSelect: false,
  options: [],
  writable: true,
  specificEntityType: 'USER',
};
const budget: DatabaseViewColumn = {
  id: 'budget',
  name: 'Budget',
  dataType: 'NUMBER',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const layout = {
  kind: 'timeline' as const,
  range: 'dates',
  title: 'name',
  groupBy: null,
  colorBy: 'labels',
  barFields: ['stage', 'removed', 'name', 'dates', 'owner', 'budget', 'labels'],
};
const launch = {
  rowId: 'launch',
  cells: {
    name: 'Launch',
    dates: '2026-03-09T14:30:00.000Z/2026-03-09T21:00:00.000Z',
    stage: 'Plan',
    labels: '["Gone","Design","Web"]',
    owner: 'macro|ada@example.com',
    budget: null,
  },
};

describe('a bar’s times', () => {
  it('shows the hours within one day, the days and hours across days, and nothing all day', () => {
    expect(
      timelineBarTime({
        allDay: false,
        start: new Date(2026, 2, 9, 9, 30),
        end: new Date(2026, 2, 9, 16, 0),
      })
    ).toBe('9:30 AM – 4 PM');
    expect(
      timelineBarTime({
        allDay: false,
        start: new Date(2026, 9, 9, 10, 30),
        end: new Date(2026, 9, 13, 17, 0),
      })
    ).toBe('Oct 9, 10:30 AM → Oct 13, 5 PM');
    expect(
      timelineBarTime({
        allDay: true,
        start: new Date(2026, 9, 9),
        end: new Date(2026, 9, 13),
      })
    ).toBeUndefined();
  });
});

describe('a bar’s fields', () => {
  it('can be any column but the title and the range', () => {
    expect(
      timelineBarFieldColumns(layout, [name, dates, stage, owner], 'name')
    ).toEqual([stage, owner]);
  });

  it('are the named fields holding something, in the view’s order, with option colors', () => {
    expect(
      timelineBarFields(
        launch,
        layout,
        [name, dates, stage, labels, owner, budget],
        'name'
      )
    ).toEqual([
      { columnId: 'stage', name: 'Stage', text: 'Plan', colors: ['#0091FF'] },
      {
        columnId: 'owner',
        name: 'Owner',
        text: 'ada@example.com',
        colors: [],
      },
      {
        columnId: 'labels',
        name: 'Labels',
        text: 'Gone, Design, Web',
        colors: ['#8E4EC6', '#46A758'],
      },
    ]);
  });
});

describe('a bar’s color', () => {
  it('comes from the select and tag columns only', () => {
    expect(
      timelineColorColumns([name, dates, stage, labels, owner, budget])
    ).toEqual([stage, labels]);
    expect(timelineColorColumn(layout, [name, labels])).toBe(labels);
    expect(
      timelineColorColumn({ ...layout, colorBy: 'budget' }, [name, budget])
    ).toBeUndefined();
    expect(timelineColorColumn({ ...layout, colorBy: null }, [labels])).toBe(
      undefined
    );
  });

  it('tints by the first option still colored and dots the rest', () => {
    expect(timelineBarColor(launch, labels)).toEqual({
      tint: '#8E4EC6',
      dots: ['#46A758'],
    });
    expect(timelineBarColor(launch, stage)).toEqual({
      tint: '#0091FF',
      dots: [],
    });
  });

  it('stays neutral for an empty cell, a removed or uncolored option, or no column', () => {
    expect(
      timelineBarColor({ rowId: 'a', cells: { stage: null } }, stage)
    ).toEqual({ tint: undefined, dots: [] });
    expect(
      timelineBarColor({ rowId: 'b', cells: { stage: 'Gone' } }, stage)
    ).toEqual({ tint: undefined, dots: [] });
    expect(
      timelineBarColor({ rowId: 'c', cells: { stage: 'Build' } }, stage)
    ).toEqual({ tint: undefined, dots: [] });
    expect(timelineBarColor(launch, undefined)).toEqual({
      tint: undefined,
      dots: [],
    });
  });
});
