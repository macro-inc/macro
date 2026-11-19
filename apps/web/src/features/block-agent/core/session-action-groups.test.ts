import { describe, expect, it } from 'vitest';
import { sessionActionGroups } from './session-action-groups';

describe('sessionActionGroups', () => {
  it('retains the phone action order when shared actions have separate identities', () => {
    const rename = { id: 'operation-0', orderKey: 'rename' };
    const archive = { id: 'operation-1', orderKey: 'archive' };
    const copyLink = { id: 'copy-link' };
    const share = { id: 'tool-1' };
    const open = { id: 'tool-0' };
    const remove = { id: 'operation-2', orderKey: 'delete' };
    const groups = {
      open: [open],
      'most-used': [share],
      copy: [copyLink],
      modify: [rename],
      'share-export': [],
      state: [archive],
      info: [],
      delete: [remove],
    };

    const result = sessionActionGroups(groups, 'operation-0');

    expect(result.modify).toEqual([rename, copyLink, share, open]);
    expect(result.delete).toEqual([archive, { ...remove, danger: true }]);
    expect(result.delete[0]).toBe(archive);
    expect(result.modify[0]).toBe(rename);
    expect(groups.delete).toEqual([remove]);
    expect(groups.state).toEqual([archive]);
    expect(result.open).toEqual([]);
    expect(result['most-used']).toEqual([]);
    expect(result.copy).toEqual([]);
    expect(result['share-export']).toEqual([]);
    expect(result.state).toEqual([]);
    expect(result.info).toEqual([]);
  });
});
