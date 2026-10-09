import { describe, expect, it } from 'vitest';
import { moveBeside } from './move-beside';

describe('moving an id beside another', () => {
  it('puts it on the side asked, whichever way it travels', () => {
    expect(moveBeside(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(moveBeside(['a', 'b', 'c'], 'a', 'b', 'after')).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(moveBeside(['a', 'b', 'c'], 'a', 'c', 'before')).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('moves nothing onto itself or beside an id the order lacks', () => {
    expect(moveBeside(['a', 'b'], 'a', 'a', 'after')).toBeUndefined();
    expect(moveBeside(['a', 'b'], 'a', 'gone', 'after')).toBeUndefined();
    expect(moveBeside(['a', 'b'], 'gone', 'a', 'after')).toBeUndefined();
  });
});
