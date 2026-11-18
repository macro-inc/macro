import { describe, expect, it } from 'vitest';
import { sessionActionGroups } from './session-action-groups';

describe('session action groups', () => {
  it('orders retained identity actions before extras and archive/delete', () => {
    const rename = { id: 'operation-0' };
    const share = { id: 'tool-1' };
    const copy = { id: 'copy-link' };
    const archive = { id: 'archive' };
    const extra = { id: 'external' };
    const result = sessionActionGroups(
      {
        entity: [share, archive, extra],
        sender: [],
        sharing: [copy],
        macro: [],
        file: [rename],
        delete: [{ id: 'remove' }],
      },
      rename.id
    );
    expect(result.entity).toEqual([rename, copy, share, extra]);
    expect(result.entity[0]).toBe(rename);
    expect(result.delete).toEqual([archive, { id: 'remove', danger: true }]);
  });
  it('does not invent unavailable owner actions', () => {
    const result = sessionActionGroups({
      entity: [],
      sender: [],
      sharing: [{ id: 'copy-link' }],
      macro: [],
      file: [],
      delete: [],
    });
    expect(result.entity).toEqual([{ id: 'copy-link' }]);
    expect(result.delete).toEqual([]);
  });
});
