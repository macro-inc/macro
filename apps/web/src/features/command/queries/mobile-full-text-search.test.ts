import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import type { CreateSearchStateOptions } from '@app/features/soup/search/create-search-state';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { EntitySearchCategory } from './entity-search';
import { createMobileFullTextSearch } from './mobile-full-text-search';

const capture = vi.hoisted(() => ({
  options: undefined as CreateSearchStateOptions | undefined,
}));
vi.mock('@app/features/soup/search', () => ({
  createSearchState: (options: CreateSearchStateOptions) => {
    capture.options = options;
    return {};
  },
}));

it('maps Email and People without mailbox facets and gates Projects/empty queries', () => {
  createRoot((dispose) => {
    const [category, setCategory] = createSignal<EntitySearchCategory>('email');
    const [query, setQuery] = createSignal('teo');
    createMobileFullTextSearch(query, category);
    const options = capture.options!;
    const email = options.buildRequest({
      query: query(),
      matchType: 'partial',
    }).body;
    expect(email.query).toBe('teo');
    expect(email.search_on).toBe('name_content');
    expect(email.filters?.email_filters).toBeUndefined();
    expect(email.filters?.channel_filters?.channel_ids).toEqual([NIL_UUID]);
    expect(email.filters?.document_filters?.document_ids).toEqual([NIL_UUID]);
    expect(options.disableLocalSearch?.()).toBe(true);
    setCategory('dms');
    const people = options.buildRequest({
      query: query(),
      matchType: 'partial',
    }).body;
    expect(people.filters?.email_filters?.email_thread_ids).toEqual([NIL_UUID]);
    expect(people.filters?.channel_filters).toBeUndefined();
    setCategory('projects');
    expect(options.enabled?.()).toBe(false);
    setCategory('all');
    setQuery('  ');
    expect(options.enabled?.()).toBe(false);
    dispose();
  });
});
