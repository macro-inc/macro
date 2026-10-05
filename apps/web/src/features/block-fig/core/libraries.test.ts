import type {
  LibraryCopy,
  LibraryUse,
  PublishedAsset,
  PublishedLibrary,
} from '@core/fig-engine/library-types';
import { describe, expect, it } from 'vitest';
import {
  detachedCopies,
  groupAssets,
  libraryUpdates,
  styleKind,
  updateSummary,
  withLibrary,
} from './libraries';

const asset = (
  a: Partial<PublishedAsset> & { key: string }
): PublishedAsset => ({
  id: `1:${a.key}`,
  name: a.key,
  kind: 'COMPONENT',
  version: 'v1',
  description: null,
  set: null,
  setKey: null,
  page: 0,
  width: 10,
  height: 10,
  style: null,
  variable: null,
  ...a,
});

const copy = (c: Partial<LibraryCopy> & { key: string }): LibraryCopy => ({
  id: `2147483649:${c.key}`,
  name: c.key,
  kind: 'COMPONENT',
  library: 'lib',
  version: 'v1',
  setKey: null,
  ...c,
});

const library = (assets: PublishedAsset[]): PublishedLibrary => ({
  published: true,
  note: null,
  assets,
});

describe('libraryUpdates', () => {
  it('lists copies whose library publishes another version', () => {
    const uses: LibraryUse = {
      enabled: [{ id: 'lib', name: 'Design system' }],
      copies: [copy({ key: 'card' }), copy({ key: 'icon', version: 'v2' })],
    };
    const libs = new Map([
      [
        'lib',
        library([
          asset({ key: 'card', version: 'v2' }),
          asset({ key: 'icon', version: 'v2' }),
        ]),
      ],
    ]);
    const updates = libraryUpdates(uses, libs);
    expect(updates.map((u) => [u.key, u.from, u.to, u.libraryName])).toEqual([
      ['card', 'v1', 'v2', 'Design system'],
    ]);
    expect(updates[0]?.assetId).toBe('1:card');
  });

  it('lists a component set once, not each variant', () => {
    const uses: LibraryUse = {
      enabled: [{ id: 'lib', name: 'DS' }],
      copies: [
        copy({ key: 'set', kind: 'COMPONENT_SET' }),
        copy({ key: 'a', setKey: 'set' }),
        copy({ key: 'b', setKey: 'set' }),
      ],
    };
    const libs = new Map([
      [
        'lib',
        library([
          asset({ key: 'set', kind: 'COMPONENT_SET', version: 'v2' }),
          asset({ key: 'a', set: 'Button', setKey: 'set', version: 'v2' }),
          asset({ key: 'b', set: 'Button', setKey: 'set', version: 'v2' }),
        ]),
      ],
    ]);
    expect(libraryUpdates(uses, libs).map((u) => u.key)).toEqual(['set']);
  });

  it('ignores libraries that are not enabled or not loaded', () => {
    const uses: LibraryUse = {
      enabled: [{ id: 'other', name: 'Other' }],
      copies: [copy({ key: 'card' })],
    };
    const libs = new Map([
      ['lib', library([asset({ key: 'card', version: 'v2' })])],
    ]);
    expect(libraryUpdates(uses, libs)).toEqual([]);
    expect(
      libraryUpdates(
        { ...uses, enabled: [{ id: 'lib', name: 'L' }] },
        new Map()
      )
    ).toEqual([]);
  });
});

describe('detachedCopies', () => {
  it('keeps copies of disabled libraries and of removed assets', () => {
    const uses: LibraryUse = {
      enabled: [{ id: 'lib', name: 'DS' }],
      copies: [
        copy({ key: 'kept' }),
        copy({ key: 'gone' }),
        copy({ key: 'figma', library: 'lk-123' }),
      ],
    };
    const libs = new Map([['lib', library([asset({ key: 'kept' })])]]);
    expect(detachedCopies(uses, libs).map((c) => c.key)).toEqual([
      'gone',
      'figma',
    ]);
  });
});

describe('groupAssets', () => {
  const lib = library([
    asset({ key: 'star', name: 'Icon/Star' }),
    asset({ key: 'heart', name: 'Icon/Heart' }),
    asset({ key: 'p', name: 'Type=Primary', set: 'Button', setKey: 'set' }),
    asset({ key: 'set', name: 'Button', kind: 'COMPONENT_SET' }),
    asset({
      key: 'brand',
      name: 'Brand',
      kind: 'STYLE',
      style: {
        id: '1:9',
        name: 'Brand',
        type: 'FILL',
        description: null,
        remote: false,
        paints: [],
        effects: [],
        text: null,
      },
    }),
    asset({
      key: 'surface',
      name: 'Surface',
      kind: 'VARIABLE',
      variable: {
        collection: 'Theme',
        resolvedType: 'COLOR',
        color: 'FFFFFFFF',
      },
    }),
  ]);

  it('groups components by set or folder, then styles and variables', () => {
    const groups = groupAssets(lib, '');
    expect(
      groups.map((g) => [g.kind, g.title, g.assets.map((a) => a.key)])
    ).toEqual([
      ['components', 'Button', ['p']],
      ['components', 'Icon', ['star', 'heart']],
      ['styles', 'Color styles', ['brand']],
      ['variables', 'Theme', ['surface']],
    ]);
  });

  it('searches names and sets', () => {
    expect(
      groupAssets(lib, 'heart').flatMap((g) => g.assets.map((a) => a.key))
    ).toEqual(['heart']);
    expect(
      groupAssets(lib, 'button').flatMap((g) => g.assets.map((a) => a.key))
    ).toEqual(['p']);
  });

  it('knows what a style applies to', () => {
    const style = lib.assets.find((a) => a.key === 'brand');
    expect(style && styleKind(style)).toBe('FILL');
  });
});

describe('withLibrary', () => {
  it('turns libraries on and off', () => {
    const a = { id: 'a', name: 'A' };
    const b = { id: 'b', name: 'B' };
    expect(withLibrary([a], b, true)).toEqual([a, b]);
    expect(withLibrary([a, b], a, false)).toEqual([b]);
    expect(withLibrary([a], a, true)).toEqual([a]);
  });
});

describe('updateSummary', () => {
  it('counts what changed', () => {
    const u = (kind: LibraryCopy['kind']) => ({
      library: 'l',
      libraryName: 'L',
      key: kind,
      name: kind,
      kind,
      copyId: '',
      assetId: '',
      from: null,
      to: 'v',
    });
    expect(
      updateSummary([u('COMPONENT'), u('COMPONENT_SET'), u('STYLE')])
    ).toBe('2 components, 1 style');
  });
});
