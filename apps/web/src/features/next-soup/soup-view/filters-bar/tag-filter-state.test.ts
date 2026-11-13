import { createQueryStore } from '@app/features/next-soup/filters/filter-store/query-store';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTagFilter } from './tag-filter-state';

const option = (id: string) => ({
  id,
  propertyDefinitionId: 'definition',
  displayOrder: 0,
  value: { type: 'string', value: id },
  color: null,
});

const [tagsQuery, setTagsQuery] = createStore({
  isSuccess: true,
  isPlaceholderData: false,
  isFetching: false,
  data: [{ scope: 'user', options: [option('kept'), option('doomed')] }],
});

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => tagsQuery,
}));
vi.mock('@property/tags/TagDot', () => ({ TagDot: () => null }));

const setup = (selected: string[]) =>
  createRoot((dispose) => {
    const queryFilters = createQueryStore({
      initial: {
        include: {
          tagFilters: selected.map((value) => ({
            propertyId: 'definition',
            type: 'select' as const,
            value,
          })),
        },
      },
    });
    const tagFilter = createTagFilter(queryFilters);
    return { queryFilters, tagFilter, dispose };
  });

const selectedTags = (queryFilters: ReturnType<typeof createQueryStore>) =>
  (queryFilters.state.include.tagFilters ?? []).map((filter) => filter.value);

describe('createTagFilter with a deleted tag', () => {
  beforeEach(() => {
    setTagsQuery({
      isSuccess: true,
      isPlaceholderData: false,
      isFetching: false,
      data: [{ scope: 'user', options: [option('kept'), option('doomed')] }],
    });
  });

  it('drops the deleted tag and keeps the others selected', () => {
    const { queryFilters, tagFilter, dispose } = setup(['kept', 'doomed']);
    expect(tagFilter.activeIds()).toEqual(['kept', 'doomed']);

    setTagsQuery('data', [{ scope: 'user', options: [option('kept')] }]);

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    expect(tagFilter.activeIds()).toEqual(['kept']);
    dispose();
  });

  it('returns to no tag filter when the only selected tag is deleted', () => {
    const { queryFilters, dispose } = setup(['doomed']);

    setTagsQuery('data', [{ scope: 'user', options: [option('kept')] }]);

    expect(selectedTags(queryFilters)).toEqual([]);
    dispose();
  });

  it('drops a restored selection whose tag no longer exists', () => {
    const { queryFilters, dispose } = setup(['kept', 'gone-before-load']);

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    dispose();
  });

  it('keeps the selection while the tag list is a placeholder', () => {
    setTagsQuery({ isPlaceholderData: true, data: [] });
    const { queryFilters, dispose } = setup(['kept']);

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    dispose();
  });

  it('keeps the selection until a refetch of the tag list lands', () => {
    setTagsQuery({ isFetching: true, data: [] });
    const { queryFilters, dispose } = setup(['kept']);
    expect(selectedTags(queryFilters)).toEqual(['kept']);

    setTagsQuery({
      isFetching: false,
      data: [{ scope: 'user', options: [option('kept')] }],
    });

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    dispose();
  });

  it('keeps the selection when the tag list failed to load', () => {
    setTagsQuery({ isSuccess: false, data: [] });
    const { queryFilters, dispose } = setup(['kept']);

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    dispose();
  });
});
