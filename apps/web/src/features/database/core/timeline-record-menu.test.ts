import { expect, it } from 'vitest';
import { timelineRecordActions } from './timeline-record-menu';

it('offers a viewer only Open record', () => {
  expect(
    timelineRecordActions({
      canEdit: false,
      dated: true,
      rangeWritable: true,
      titleWritable: true,
      groupWritable: true,
    })
  ).toEqual(['open']);
});

it('offers an editor every change its columns allow, in order', () => {
  expect(
    timelineRecordActions({
      canEdit: true,
      dated: true,
      rangeWritable: true,
      titleWritable: true,
      groupWritable: true,
    })
  ).toEqual([
    'open',
    'edit-range',
    'rename',
    'move',
    'remove-dates',
    'duplicate',
    'delete',
  ]);
  expect(
    timelineRecordActions({
      canEdit: true,
      dated: false,
      rangeWritable: true,
      titleWritable: false,
      groupWritable: false,
    })
  ).toEqual(['open', 'edit-range', 'add-dates', 'duplicate', 'delete']);
});

it('leaves the dates alone when the range column cannot be written', () => {
  expect(
    timelineRecordActions({
      canEdit: true,
      dated: true,
      rangeWritable: false,
      titleWritable: true,
      groupWritable: true,
    })
  ).toEqual(['open', 'rename', 'move', 'duplicate', 'delete']);
});
