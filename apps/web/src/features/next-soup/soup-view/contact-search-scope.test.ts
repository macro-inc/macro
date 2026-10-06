import { getCategorySearchFilters } from '@app/features/command/category-search-filters';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import {
  compileSearchQuery,
  DEFAULT_SECTIONS,
  type SearchTypeValue,
} from '@app/features/next-soup/soup-view/filters-bar/search/search-filters-state';
import { describe, expect, it, vi } from 'vitest';
import { isContactSearchScope } from './contact-search-scope';

// The facet compiler is pure; its controller hook is not exercised here.
vi.mock('@app/features/next-soup/soup-view/soup-view-context', () => ({
  useSoupView: () => {
    throw new Error('not used');
  },
}));

const facetScope = (
  type: SearchTypeValue,
  tags: { propertyId: string; value: string }[] = []
) =>
  isContactSearchScope({
    view: 'search',
    filters: queryStateFrom(
      compileSearchQuery({
        type,
        tags: tags.map((tag) => ({ ...tag, type: 'select' as const })),
        tagMode: 'any',
        ...DEFAULT_SECTIONS,
      })
    ),
    predicates: {
      and: ['search-supported'],
      or: type === 'all' ? [] : [type],
    },
  });

describe('global Search contact scope', () => {
  it('lists contacts in the unscoped All search, including restored and Command-K All entries', () => {
    expect(facetScope('all')).toBe(true);
    const preset = getViewPreset('search');
    expect(
      isContactSearchScope({
        view: 'search',
        filters: queryStateFrom(preset?.filters ?? {}),
        predicates: { and: ['search-supported'], or: [] },
      })
    ).toBe(true);
  });

  it.each<SearchTypeValue>([
    'document-or-file',
    'task',
    'email',
    'channels',
    'calls',
    'agent',
    'calendar',
    'folders',
  ])('excludes contacts from the %s type', (type) => {
    expect(facetScope(type)).toBe(false);
  });

  it('excludes contacts once tags narrow All to tagged results', () => {
    expect(facetScope('all', [{ propertyId: 'tags', value: 'tag-1' }])).toBe(
      false
    );
  });

  it.each(['channels', 'documents', 'tasks', 'chats'] as const)(
    'excludes contacts from a Command-K %s search handoff',
    (category) => {
      const overrides = getCategorySearchFilters(category);
      expect(overrides).toBeDefined();
      expect(
        isContactSearchScope({
          view: 'search',
          filters: queryStateFrom(overrides?.filters ?? {}),
          predicates: {
            and: overrides?.clientFilters.and ?? [],
            or: overrides?.clientFilters.or ?? [],
          },
        })
      ).toBe(false);
    }
  );

  it('hands the People search off to the unscoped All search', () => {
    expect(getCategorySearchFilters('dms')).toBeUndefined();
  });

  it('keeps contacts out of other views and folder-scoped searches', () => {
    const baseline = queryStateFrom(getViewPreset('search')?.filters ?? {});
    const predicates = { and: ['search-supported'], or: [] };
    expect(
      isContactSearchScope({ view: 'documents', filters: baseline, predicates })
    ).toBe(false);
    expect(
      isContactSearchScope({
        view: 'search',
        filters: {
          ...baseline,
          include: { ...baseline.include, projectId: ['folder'] },
        },
        predicates,
      })
    ).toBe(false);
    expect(
      isContactSearchScope({
        view: 'search',
        filters: baseline,
        predicates: { and: ['search-supported', 'in-folder'], or: [] },
      })
    ).toBe(false);
  });
});
