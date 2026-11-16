import { createQueryStore } from '@app/features/next-soup/filters/filter-store/query-store';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTagFilter } from './tag-filter-state';

const option = (id: string) => ({
  id,
  propertyDefinitionId: 'own-definition',
  displayOrder: 0,
  value: { type: 'string', value: id },
  color: null,
});

const tagSets = (...optionIds: string[]) => [
  {
    scope: 'user',
    definition: { id: 'own-definition' },
    options: optionIds.map(option),
  },
];

const MOUNTED_AT = 1_000_000;

const { invalidateTags } = vi.hoisted(() => ({ invalidateTags: vi.fn() }));
const [tagsQuery, setTagsQuery] = createStore({
  isSuccess: true,
  isPlaceholderData: false,
  isFetching: false,
  dataUpdatedAt: 0,
  data: tagSets(),
});

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => tagsQuery,
  invalidateTags,
}));
vi.mock('@property/tags/TagDot', () => ({ TagDot: () => null }));

const setup = (selected: { value: string; propertyId?: string }[]) =>
  createRoot((dispose) => {
    const queryFilters = createQueryStore({
      initial: {
        include: {
          tagFilters: selected.map(({ value, propertyId }) => ({
            propertyId: propertyId ?? 'own-definition',
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
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
    invalidateTags.mockClear();
    setTagsQuery({
      isSuccess: true,
      isPlaceholderData: false,
      isFetching: false,
      dataUpdatedAt: MOUNTED_AT - 60_000,
      data: tagSets('kept', 'doomed'),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a tag deleted while selected and keeps the others', () => {
    const { queryFilters, tagFilter, dispose } = setup([
      { value: 'kept' },
      { value: 'doomed' },
    ]);
    expect(tagFilter.activeIds()).toEqual(['kept', 'doomed']);

    setTagsQuery({ dataUpdatedAt: MOUNTED_AT + 5_000, data: tagSets('kept') });

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    expect(tagFilter.activeIds()).toEqual(['kept']);
    expect(invalidateTags).not.toHaveBeenCalled();
    dispose();
  });

  it('returns to no tag filter when the only selected tag is deleted', () => {
    const { queryFilters, dispose } = setup([{ value: 'doomed' }]);

    setTagsQuery({ dataUpdatedAt: MOUNTED_AT + 5_000, data: tagSets('kept') });

    expect(selectedTags(queryFilters)).toEqual([]);
    dispose();
  });

  it('refetches before dropping a restored tag an older list lacks', () => {
    const { queryFilters, dispose } = setup([
      { value: 'kept' },
      { value: 'deleted-before-restore' },
    ]);
    expect(selectedTags(queryFilters)).toEqual([
      'kept',
      'deleted-before-restore',
    ]);
    expect(invalidateTags).toHaveBeenCalledTimes(1);

    setTagsQuery({ isFetching: true });
    setTagsQuery({ isFetching: false, dataUpdatedAt: MOUNTED_AT + 5_000 });

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    dispose();
  });

  it('keeps a tag made elsewhere that the refetched list has', () => {
    const { queryFilters, dispose } = setup([{ value: 'made-elsewhere' }]);
    expect(invalidateTags).toHaveBeenCalledTimes(1);

    setTagsQuery({ isFetching: true });
    setTagsQuery({
      isFetching: false,
      dataUpdatedAt: MOUNTED_AT + 5_000,
      data: tagSets('kept', 'doomed', 'made-elsewhere'),
    });

    expect(selectedTags(queryFilters)).toEqual(['made-elsewhere']);
    dispose();
  });

  it("keeps a tag from a set that is not the caller's", () => {
    const { queryFilters, dispose } = setup([
      { value: 'shared-by-someone', propertyId: 'their-definition' },
    ]);

    setTagsQuery({ dataUpdatedAt: MOUNTED_AT + 5_000 });

    expect(selectedTags(queryFilters)).toEqual(['shared-by-someone']);
    expect(invalidateTags).not.toHaveBeenCalled();
    dispose();
  });

  it('keeps the selection while the tag list is a placeholder', () => {
    setTagsQuery({
      isPlaceholderData: true,
      dataUpdatedAt: MOUNTED_AT + 5_000,
      data: tagSets(),
    });
    const { queryFilters, dispose } = setup([{ value: 'kept' }]);

    expect(selectedTags(queryFilters)).toEqual(['kept']);
    dispose();
  });

  it('keeps the selection when the tag list failed to load', () => {
    const { queryFilters, dispose } = setup([{ value: 'doomed' }]);

    setTagsQuery({
      isSuccess: false,
      dataUpdatedAt: MOUNTED_AT + 5_000,
      data: tagSets('kept'),
    });

    expect(selectedTags(queryFilters)).toEqual(['doomed']);
    dispose();
  });
});
