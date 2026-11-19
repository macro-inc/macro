import { describe, expect, it } from 'vitest';
import { unusableItemsFromWire } from './unusable-items';

describe('knobs needing a new pick, from the scheduler', () => {
  const gone = { type: 'channel' as const, id: 'gone' };

  it('keep each by its step id, leaving out unpicked knobs and steps without one', () => {
    expect(
      unusableItemsFromWire([
        { step: 'post', knob: 'archive', item: gone, reason: 'Deleted' },
        { step: 'post', knob: 'unpicked', item: null, reason: 'Not picked' },
        { step: null, knob: 'archive', item: gone, reason: 'Saved before ids' },
        { knob: 'archive', item: gone, reason: 'No step id' },
      ])
    ).toEqual([
      { step: 'post', knob: 'archive', item: gone, reason: 'Deleted' },
    ]);
  });

  it('keep the sub-routine a step is in', () => {
    expect(
      unusableItemsFromWire([
        {
          sub_routine: 'remind',
          step: 'post',
          knob: 'archive',
          item: gone,
          reason: 'Deleted',
        },
      ])
    ).toStrictEqual([
      {
        subRoutine: 'remind',
        step: 'post',
        knob: 'archive',
        item: gone,
        reason: 'Deleted',
      },
    ]);
  });
});
