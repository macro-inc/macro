import { expect, it } from 'vitest';
import { mergeAgendaWindowGroups } from './create-agenda-grouping';

const group = (start: number, end: number) => ({
  start: new Date(2030, 10, start),
  end: new Date(2030, 10, end),
  events: [],
});

it('collapses consecutive empty windows without mutating their source groups', () => {
  const first = group(1, 14),
    second = group(15, 28);
  const result = mergeAgendaWindowGroups(
    [
      { index: 0, value: { complete: true, groups: [first] } },
      { index: 1, value: { complete: true, groups: [second] } },
    ],
    new Date(2030, 11, 1)
  );
  expect(result[0].groups[0].end.getDate()).toBe(28);
  expect(result[1].groups).toEqual([]);
  expect(first.end.getDate()).toBe(14);
});
it('keeps today and incomplete window boundaries distinct', () => {
  const windows = [
    { index: 0, value: { complete: true, groups: [group(1, 14)] } },
    {
      index: 1,
      value: { complete: true, groups: [group(15, 15), group(16, 28)] },
    },
  ];
  const result = mergeAgendaWindowGroups(windows, new Date(2030, 10, 15));
  expect(result[0].groups).toHaveLength(1);
  expect(result[1].groups).toHaveLength(2);
  windows[1].value.complete = false;
  expect(
    mergeAgendaWindowGroups(
      windows,
      new Date(2030, 11, 1)
    )[0].groups[0].end.getDate()
  ).toBe(14);
});
