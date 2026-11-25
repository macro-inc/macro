import type { SearchOperatorLookup } from '@app/features/next-soup/core/search-operator-filters';
import type { CreateSearchStateOptions } from '@app/features/soup/search/create-search-state';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createMobileFullTextSearch } from './mobile-full-text-search';

const capture = vi.hoisted(() => ({
  options: undefined as CreateSearchStateOptions | undefined,
  browse: undefined as
    | { request: () => { body: unknown }; options: () => { enabled: boolean } }
    | undefined,
  pending: false,
  serviceEnabled: true,
  browseState: { isPending: false, isFetching: false },
}));
vi.mock('@app/features/soup/search', () => ({
  createSearchState: (options: CreateSearchStateOptions) => {
    capture.options = options;
    return {
      isSettling: () => false,
      searchQuery: {
        get isPending() {
          return capture.pending;
        },
        get isEnabled() {
          return capture.serviceEnabled && (options.enabled?.() ?? true);
        },
      },
    };
  },
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: (
    request: () => { body: unknown },
    options: () => { enabled: boolean }
  ) => {
    capture.browse = { request, options };
    return capture.browseState;
  },
}));

const LOOKUP: SearchOperatorLookup = {
  userId: 'macro|me@example.com',
  tags: () => [],
  inboxes: () => [],
  channels: () => [],
};

it('keeps an enabled initial query settling before it starts fetching', () => {
  createRoot((dispose) => {
    const [query, setQuery] = createSignal('teo');
    const search = createMobileFullTextSearch(query, () => LOOKUP);
    capture.pending = true;
    expect(search.isSettling()).toBe(true);
    capture.pending = false;
    expect(search.isSettling()).toBe(false);
    capture.pending = true;
    capture.serviceEnabled = false;
    expect(search.isSettling()).toBe(false);
    capture.serviceEnabled = true;
    setQuery('');
    expect(search.isSettling()).toBe(false);
    capture.pending = false;
    dispose();
  });
});

it('sends words with their operators, and lists operators alone through the feed', () => {
  createRoot((dispose) => {
    const [query, setQuery] = createSignal('type:task teo');
    createMobileFullTextSearch(query, () => LOOKUP);
    const options = capture.options!;
    expect(options.text()).toBe('type:task teo');
    expect(options.enabled?.()).toBe(true);
    expect(options.disableLocalSearch?.()).toBe(true);
    expect(capture.browse?.options().enabled).toBe(false);

    // The service refuses operators alone outside email.
    setQuery('assignee:me status:in_progress');
    expect(options.enabled?.()).toBe(false);
    expect(capture.browse?.options().enabled).toBe(true);
    expect(JSON.stringify(capture.browse?.request().body)).toContain(
      'me@example.com'
    );

    // The feed can't tell messages by sender, so a sender alone lists nothing.
    setQuery('type:channel from:me');
    expect(options.enabled?.()).toBe(false);
    expect(capture.browse?.options().enabled).toBe(false);

    setQuery('  ');
    expect(options.enabled?.()).toBe(false);
    expect(capture.browse?.options().enabled).toBe(false);
    dispose();
  });
});

it('keeps listed rows settled while an operator-only search refetches', () => {
  createRoot((dispose) => {
    const [query] = createSignal('assignee:me');
    const search = createMobileFullTextSearch(query, () => LOOKUP);
    Object.assign(capture.browseState, { isPending: true, isFetching: true });
    expect(search.isSettling()).toBe(true);
    Object.assign(capture.browseState, { isPending: false, isFetching: true });
    expect(search.isSettling()).toBe(false);
    Object.assign(capture.browseState, { isPending: false, isFetching: false });
    dispose();
  });
});

it("applies the opener's bound tag by id, beside a word and alone", () => {
  createRoot((dispose) => {
    const binding = {
      token: 'tag:"🎉"',
      tags: [{ propertyId: 'prop-1', optionId: 'opt-1' }],
    };
    const [query, setQuery] = createSignal('tag:"🎉" launch');
    createMobileFullTextSearch(
      query,
      () => LOOKUP,
      () => [binding]
    );
    const options = capture.options!;
    // The bound token goes with the request by id, not as a word.
    expect(options.text()).toBe('launch');
    expect(
      JSON.stringify(
        options.buildRequest({ query: 'launch', matchType: 'partial' })
      )
    ).toContain('opt-1');

    setQuery('tag:"🎉"');
    expect(options.enabled?.()).toBe(false);
    expect(capture.browse?.options().enabled).toBe(true);
    expect(JSON.stringify(capture.browse?.request().body)).toContain('opt-1');
    dispose();
  });
});
