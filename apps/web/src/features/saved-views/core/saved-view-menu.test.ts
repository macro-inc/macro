import { describe, expect, it } from 'vitest';
import { savedViewMenuGroups } from './saved-view-menu';

describe('saved view menu groups', () => {
  it('orders copy before edits, movement and isolated delete', () => {
    expect(
      savedViewMenuGroups({
        owned: true,
        copyLink: true,
        moveUp: true,
        moveDown: true,
      })
    ).toEqual([
      ['copy-link'],
      ['edit', 'duplicate', 'move-up', 'move-down'],
      ['delete'],
    ]);
  });

  it('preserves host and ownership gates without empty groups', () => {
    expect(
      savedViewMenuGroups({
        owned: false,
        copyLink: false,
        moveUp: false,
        moveDown: true,
      })
    ).toEqual([['duplicate', 'move-down']]);
    expect(
      savedViewMenuGroups({
        owned: true,
        copyLink: false,
        moveUp: false,
        moveDown: false,
      })
    ).toEqual([['edit', 'duplicate'], ['delete']]);
  });
});
