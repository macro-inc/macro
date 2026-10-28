import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import {
  reuseTimelineItems,
  timelineGroupColumn,
  timelineItems,
} from './timeline';

const stage: DatabaseViewColumn = {
  id: 'stage',
  name: 'Stage',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  options: [
    { id: 'plan', label: 'Plan', color: null },
    { id: 'build', label: 'Build', color: null },
  ],
  writable: true,
};
const owner: DatabaseViewColumn = {
  id: 'owner',
  name: 'Owner',
  dataType: 'ENTITY',
  specificEntityType: 'USER',
  isMultiSelect: false,
  options: [],
  writable: true,
};
const launch = {
  rowId: 'launch',
  cells: {
    dates: '2026-03-02T00:00:00.000Z/2026-03-06T00:00:00.000Z',
    stage: 'Build',
    owner: 'macro|ada@macro.com',
  },
};
const research = {
  rowId: 'research',
  cells: { dates: null, stage: 'Plan', owner: null },
};
const kickoff = {
  rowId: 'kickoff',
  cells: {
    dates: '2026-02-23T00:00:00.000Z/2026-02-23T00:00:00.000Z',
    stage: null,
    owner: 'macro|ada@macro.com',
  },
};

describe('a timeline without groups', () => {
  it('lists dated records in order, then the undated under their own heading', () => {
    expect(
      timelineItems({
        rows: [research, launch, kickoff],
        rangeColumnId: 'dates',
      })
    ).toEqual([
      {
        kind: 'record',
        id: 'launch',
        row: launch,
        group: '',
        range: {
          allDay: true,
          start: new Date(2026, 2, 2),
          end: new Date(2026, 2, 6),
        },
      },
      {
        kind: 'record',
        id: 'kickoff',
        row: kickoff,
        group: '',
        range: {
          allDay: true,
          start: new Date(2026, 1, 23),
          end: new Date(2026, 1, 23),
        },
      },
      { kind: 'undated', id: 'undated', count: 1 },
      {
        kind: 'record',
        id: 'research',
        row: research,
        group: '',
        range: undefined,
      },
    ]);
  });

  it('has no undated heading when every record has dates', () => {
    expect(
      timelineItems({ rows: [kickoff], rangeColumnId: 'dates' }).map(
        (item) => item.id
      )
    ).toEqual(['kickoff']);
  });
});

describe('a timeline grouped by a single select', () => {
  it('lists every option, even an empty one, then the records with no option', () => {
    expect(
      timelineItems({
        rows: [research, launch, kickoff],
        rangeColumnId: 'dates',
        groupColumn: stage,
      })
    ).toEqual([
      {
        kind: 'group',
        id: 'group:option:plan',
        group: 'option:plan',
        lane: { kind: 'option', id: 'plan' },
        label: 'Plan',
        count: 1,
      },
      {
        kind: 'record',
        id: 'research',
        row: research,
        group: 'option:plan',
        range: undefined,
      },
      {
        kind: 'group',
        id: 'group:option:build',
        group: 'option:build',
        lane: { kind: 'option', id: 'build' },
        label: 'Build',
        count: 1,
      },
      {
        kind: 'record',
        id: 'launch',
        row: launch,
        group: 'option:build',
        range: {
          allDay: true,
          start: new Date(2026, 2, 2),
          end: new Date(2026, 2, 6),
        },
      },
      {
        kind: 'group',
        id: 'group:no-option',
        group: 'no-option',
        lane: { kind: 'none' },
        label: 'No stage',
        count: 1,
      },
      {
        kind: 'record',
        id: 'kickoff',
        row: kickoff,
        group: 'no-option',
        range: {
          allDay: true,
          start: new Date(2026, 1, 23),
          end: new Date(2026, 1, 23),
        },
      },
    ]);
  });

  it('keeps a collapsed group and its count but none of its records', () => {
    expect(
      timelineItems({
        rows: [research, launch, kickoff],
        rangeColumnId: 'dates',
        groupColumn: stage,
        collapsed: new Set(['option:build']),
      }).map((item) => item.id)
    ).toEqual([
      'group:option:plan',
      'research',
      'group:option:build',
      'group:no-option',
      'kickoff',
    ]);
  });
});

describe('a timeline grouped by a person', () => {
  it('groups by each person who appears, dated records first', () => {
    expect(
      timelineItems({
        rows: [research, kickoff, launch],
        rangeColumnId: 'dates',
        groupColumn: owner,
      }).map((item) =>
        item.kind === 'group' ? `${item.label} (${item.count})` : item.id
      )
    ).toEqual([
      'ada@macro.com (2)',
      'kickoff',
      'launch',
      'No owner (1)',
      'research',
    ]);
  });
});

describe('the column a timeline groups by', () => {
  it('is the named single select or person, and nothing for another column', () => {
    const layout = {
      kind: 'timeline' as const,
      range: 'dates',
      title: 'name',
      groupBy: 'stage',
      colorBy: null,
    };
    expect(timelineGroupColumn(layout, [stage, owner])).toBe(stage);
    expect(
      timelineGroupColumn({ ...layout, groupBy: null }, [stage, owner])
    ).toBeUndefined();
    expect(
      timelineGroupColumn(layout, [{ ...stage, isMultiSelect: true }])
    ).toBeUndefined();
  });
});

describe('a timeline read again', () => {
  it('keeps the items that did not change, so their rows stay mounted', () => {
    const before = timelineItems({
      rows: [research, launch],
      rangeColumnId: 'dates',
      groupColumn: stage,
    });
    const moved = { ...launch, cells: { ...launch.cells, stage: 'Plan' } };
    const after = reuseTimelineItems(
      before,
      timelineItems({
        rows: [research, moved],
        rangeColumnId: 'dates',
        groupColumn: stage,
      })
    );
    expect(after.map((item) => before.includes(item))).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(after.map((item) => item.id)).toEqual([
      'group:option:plan',
      'launch',
      'research',
      'group:option:build',
      'group:no-option',
    ]);
  });
});
