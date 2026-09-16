import {
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
} from '@queries/soup/graphql/ast';
import type { SoupApiItem } from '@service-storage/generated/schemas/soupApiItem';
import { describe, expect, it, vi } from 'vitest';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '../filters/filter-store/compile';
import { createQueryStore } from '../filters/filter-store/query-store';
import {
  applyDocumentTabScope,
  withDocumentTabItemScope,
} from './document-tab-scope';

const ME = 'macro|me@example.com';
const OTHER = 'macro|other@example.com';
const NIL = '00000000-0000-0000-0000-000000000000';
const params = { limit: 100, sort_method: 'updated_at' as const };

function sharedStore() {
  return createQueryStore({
    initial: defineQueryFilters({ exclude: { documentOwnerId: [ME] } }),
  });
}

function sharedBody(store: ReturnType<typeof sharedStore>) {
  return compileToAst(applyDocumentTabScope(store.state, 'shared', ME));
}

describe('Shared Files cache admission scope', () => {
  const document = (ownerId: string) =>
    ({ tag: 'document', data: { ownerId } }) as SoupApiItem;

  it('keeps cached query scope fixed after tab or viewer changes', () => {
    let tab = 'shared';
    let viewer = ME;
    const shared = withDocumentTabItemScope(tab, viewer, () => true);
    tab = 'owned';
    viewer = OTHER;
    expect(shared(document(ME))).toBe(false);
    expect(shared(document(OTHER))).toBe(true);
    expect(
      withDocumentTabItemScope(tab, viewer, () => true)(document(ME))
    ).toBe(true);
  });

  it('does not replace the downstream membership filter or filter non-document ownership', () => {
    const downstream = vi.fn(() => false);
    const filter = withDocumentTabItemScope('shared', ME, downstream);
    const otherDocument = document(OTHER);
    expect(filter(otherDocument)).toBe(false);
    expect(downstream).toHaveBeenCalledWith(otherDocument);
    downstream.mockReturnValue(true);
    const project = { tag: 'project', data: { ownerId: ME } } as SoupApiItem;
    expect(filter(project)).toBe(true);
    expect(downstream).toHaveBeenCalledWith(project);
    expect(
      withDocumentTabItemScope('shared', undefined, downstream)(project)
    ).toBe(true);
  });

  it('leaves admission for other tabs and non-Files queries unchanged', () => {
    const downstream = vi.fn(() => true);
    for (const tab of ['owned', 'attachments', 'folders', 'all', undefined]) {
      expect(withDocumentTabItemScope(tab, undefined, downstream)).toBe(
        downstream
      );
    }
  });
});

describe('Shared Files request scope', () => {
  it('ANDs Created by me with non-ownership in REST and flat/grouped GraphQL requests', () => {
    const store = sharedStore();
    store.set({ include: { documentOwnerId: [ME] } });
    const body = sharedBody(store);
    expect(body.df).toEqual({
      '&': [{ l: { o: ME } }, { '!': { l: { o: ME } } }],
    });
    const expected = {
      and: {
        left: { literal: { owner: ME } },
        right: { not: { literal: { owner: ME } } },
      },
    };
    expect(
      makeGraphqlSoupInput({ params, body }).initial?.filters?.documentFilter
    ).toEqual(expected);
    expect(
      makeGraphqlGroupedSoupInput({
        params,
        body,
        groupBy: { type: 'entity_type' },
      }).initial?.filters?.documentFilter
    ).toEqual(expected);
  });

  it('keeps the exclusion with a mixed creator selection and restores it after clearing', () => {
    const store = sharedStore();
    store.set({ include: { documentOwnerId: [ME, OTHER] } });
    expect(sharedBody(store).df).toEqual({
      '&': [
        { '|': [{ l: { o: ME } }, { l: { o: OTHER } }] },
        { '!': { l: { o: ME } } },
      ],
    });
    store.set({ include: { documentOwnerId: undefined } });
    expect(sharedBody(store).df).toEqual({ '!': { l: { o: ME } } });
    store.set({ include: { documentOwnerId: [OTHER] } });
    expect(sharedBody(store).df).toEqual({
      '&': [{ l: { o: OTHER } }, { '!': { l: { o: ME } } }],
    });
  });

  it('repairs legacy/restored filters without changing persisted state or other tabs', () => {
    const state = queryStateFrom(
      defineQueryFilters({ include: { documentOwnerId: [ME] } })
    );
    const saved = JSON.stringify(state);
    const scoped = applyDocumentTabScope(state, 'shared', ME);
    expect(compileToAst(scoped).df).toEqual({
      '&': [{ l: { o: ME } }, { '!': { l: { o: ME } } }],
    });
    expect(JSON.stringify(state)).toBe(saved);
    for (const tab of ['owned', 'attachments', 'folders', 'all', undefined]) {
      expect(applyDocumentTabScope(state, tab, ME)).toBe(state);
    }
  });

  it('retains type and tag refinements when injecting the tab constraint', () => {
    const state = queryStateFrom({
      include: {
        documentOwnerId: [ME],
        tagFilters: [
          { propertyId: 'definition', type: 'select', value: 'tag' },
        ],
      },
      exclude: {},
      documentWhere: { include: { fileType: ['pdf'] } },
    });
    const scoped = applyDocumentTabScope(state, 'shared', ME);
    expect(scoped.documentWhere).toEqual([
      { include: { fileType: ['pdf'] } },
      { exclude: { documentOwnerId: [ME] } },
    ]);
    expect(scoped.include).toEqual(state.include);
    expect(compileToAst(scoped).propf).toEqual(compileToAst(state).propf);
    expect(state.documentWhere).toHaveLength(1);
  });

  it('does not widen Shared before viewer identity is available', () => {
    const scoped = applyDocumentTabScope(
      queryStateFrom({}),
      'shared',
      undefined
    );
    expect(compileToAst(scoped).df).toEqual({ l: { id: NIL } });
  });
});
