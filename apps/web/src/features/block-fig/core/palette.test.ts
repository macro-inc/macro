import { describe, expect, it } from 'vitest';
import { paletteActions } from './palette';
import { SHORTCUT_GROUPS } from './shortcuts';

describe('actions menu', () => {
  it('lists every action with a shortcut, but not itself', () => {
    const all = paletteActions('');
    const ids = all.map((a) => a.id);
    expect(ids).toContain('tool-pencil');
    expect(ids).toContain('align-left');
    expect(ids).not.toContain('open-actions');
    expect(new Set(ids).size).toBe(ids.length);
    const withIds = SHORTCUT_GROUPS.flatMap((g) => g.items).filter(
      (i) => i.id && i.id !== 'open-actions'
    );
    expect(all).toHaveLength(withIds.length);
  });

  it('finds actions by the starts of words in their names and groups', () => {
    expect(paletteActions('penc').map((a) => a.id)).toEqual(['tool-pencil']);
    expect(paletteActions('align bot').map((a) => a.id)).toEqual([
      'align-bottom',
    ]);
    expect(paletteActions('zoom').every((a) => a.group === 'Zoom')).toBe(true);
    expect(paletteActions('xyzzy')).toEqual([]);
  });

  it('puts names starting with the query first', () => {
    expect(paletteActions('flip')[0]?.label.startsWith('Flip')).toBe(true);
  });
});
