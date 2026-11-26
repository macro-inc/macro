import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type Setter } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Channel = {
  kind: 'entity';
  id: string;
  bucket: 'channel';
  searchText: string;
  data: { type: 'channel'; id: string; name: string };
};
const source = vi.hoisted(() => ({
  items: undefined as unknown as () => unknown[],
  icons: 0,
}));

vi.mock('@app/features/crm/crm-search', () => ({
  useCrmCompanySearchSource: () => ({
    companies: () => [],
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    error: () => undefined,
    retry: async () => {},
  }),
}));
vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactMentionSource: () => ({
    entities: () => [],
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    error: () => undefined,
    retry: async () => {},
  }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'alice@example.com',
  useUserId: () => () => 'macro|alice@example.com',
}));
vi.mock('@core/user', () => ({
  emailToId: (email: string) => `macro|${email}`,
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@queries/contacts/use-directory', () => ({
  usePinnedContactUsers: () => () => [],
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    isLoading: () => false,
    useList: () => ({
      isLoading: () => false,
      isLoadingMore: () => false,
      hasMore: () => false,
      error: () => undefined,
      windowKey: () => undefined,
      loadMore: async () => {},
      items: () => source.items(),
    }),
  }),
}));
vi.mock('@entity', () => ({
  Entity: {
    // Each channel icon looks up its channel's picture.
    Icon: () => {
      source.icons += 1;
      return <span />;
    },
    Title: (props: { entity: { name: string } }) => (
      <span>{props.entity.name}</span>
    ),
  },
  createEmailsInfiniteQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('@queries/soup/search', () => ({
  validateSearchServiceText: (text: string) => text.length > 0,
  useSearchSoupQuery: () => ({ status: 'pending', isFetching: false }),
}));
vi.mock('@property/utils', () => ({ useSearchInputFocus: () => undefined }));

import { PropertyEntitySelector } from './PropertyEntitySelector';

const LIST_HEIGHT = 192;
const ROW_HEIGHT = 36;

// The layout jsdom lacks and the virtualizer reads: a scroller of
// LIST_HEIGHT, and rows of ROW_HEIGHT.
class LayoutResizeObserver implements ResizeObserver {
  constructor(private readonly notify: ResizeObserverCallback) {}
  observe(target: Element) {
    const height = target.matches('.overflow-y-auto')
      ? LIST_HEIGHT
      : ROW_HEIGHT;
    this.notify(
      [{ target, contentRect: { height, width: 320 } } as ResizeObserverEntry],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

const channel = (index: number): Channel => ({
  kind: 'entity',
  id: `channel-${index}`,
  bucket: 'channel',
  searchText: `channel ${index}`,
  data: { type: 'channel', id: `channel-${index}`, name: `Channel ${index}` },
});

let setItems: Setter<Channel[]>;
beforeEach(() => {
  const [items, set] = createSignal(
    Array.from({ length: 2000 }, (_, i) => channel(i))
  );
  source.items = items;
  source.icons = 0;
  setItems = set;
  vi.stubGlobal('ResizeObserver', LayoutResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const rows = () => document.querySelectorAll('[data-entity-index]');

describe('an entity selector with thousands of items', () => {
  it('mounts only the rows in view, and rebuilds only those on a change', async () => {
    render(() => (
      <PropertyEntitySelector
        config={{
          isMultiSelect: false,
          specificEntityType: 'CHANNEL',
          placeholder: 'Find',
        }}
        selectedOptions={() => new Set()}
        setSelectedOptions={() => {}}
      />
    ));
    await screen.findByText('Channel 0');
    expect(rows().length).toBeGreaterThan(5);
    expect(rows().length).toBeLessThan(40);

    // A message in any channel gives the list new items.
    source.icons = 0;
    setItems((items) => items.map((item) => ({ ...item })));
    expect(rows().length).toBeLessThan(40);
    expect(source.icons).toBeLessThan(40);
  });
});
