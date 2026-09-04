import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

import { decodePairs } from '../layoutUtils';

describe('decodePairs Connections rest', () => {
  it('keeps a connections rest token on the settings split', () => {
    expect(decodePairs(['settings', 'connections', 'discover'])).toEqual([
      { type: 'component', id: 'settings' },
    ]);
    expect(
      decodePairs(['settings', 'connections', 'github', 'component', 'inbox'])
    ).toEqual([
      { type: 'component', id: 'settings' },
      { type: 'component', id: 'inbox' },
    ]);
  });

  it('does not consume an unknown token as Connections rest', () => {
    expect(
      decodePairs(['settings', 'connections', 'nope', 'component', 'inbox'])
    ).toEqual([
      { type: 'component', id: 'settings' },
      { type: 'nope', id: 'component' },
    ]);
  });
});
