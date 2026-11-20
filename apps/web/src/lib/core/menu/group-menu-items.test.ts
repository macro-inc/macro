import { describe, expect, it } from 'vitest';
import { groupMenuItems, type MenuGroup } from './group-menu-items';

describe('groupMenuItems', () => {
  it('orders nonempty sections and preserves action order inside each section', () => {
    const actions: { id: string; group: MenuGroup }[] = [
      { id: 'delete', group: 'delete' },
      { id: 'copy-link', group: 'copy' },
      { id: 'rename', group: 'modify' },
      { id: 'open', group: 'open' },
      { id: 'history', group: 'info' },
      { id: 'share', group: 'most-used' },
      { id: 'download', group: 'share-export' },
      { id: 'mute', group: 'state' },
      { id: 'copy-id', group: 'copy' },
    ];

    expect(groupMenuItems(actions, (action) => action.group)).toEqual([
      { id: 'open', items: [actions[3]] },
      { id: 'most-used', items: [actions[5]] },
      { id: 'copy', items: [actions[1], actions[8]] },
      { id: 'modify', items: [actions[2]] },
      { id: 'share-export', items: [actions[6]] },
      { id: 'state', items: [actions[7]] },
      { id: 'info', items: [actions[4]] },
      { id: 'delete', items: [actions[0]] },
    ]);
    expect(actions[0].id).toBe('delete');
    expect(groupMenuItems([], () => 'open')).toEqual([]);
  });

  it('retains live metadata, handlers, and repeated actions without cloning', () => {
    let label = 'Favorite';
    const run = () => {};
    const action = {
      get label() {
        return label;
      },
      run,
    };
    const sections = groupMenuItems([action, action], () => 'most-used');

    expect(sections[0].items).toEqual([action, action]);
    expect(sections[0].items[0]).toBe(action);
    expect(sections[0].items[1].run).toBe(run);
    label = 'Unfavorite';
    expect(sections[0].items[0].label).toBe('Unfavorite');
  });
});
