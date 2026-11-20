import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({
  emailBrowse: [] as boolean[],
  emailSearch: [] as boolean[],
  pinnedPeople: [] as boolean[],
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
  usePinnedContactUsers: (_selected: unknown, enabled: () => boolean) => () => {
    sources.pinnedPeople.push(enabled());
    return enabled()
      ? [{ id: 'macro|pat@example.com', name: 'Pat', email: 'pat@example.com' }]
      : [];
  },
}));
// Quick Access holds the task; threads come from email's own browse list.
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    isLoading: () => false,
    useList: (options: { buckets: string[] }) => ({
      isLoading: () => false,
      isLoadingMore: () => false,
      hasMore: () => false,
      error: () => undefined,
      windowKey: () => undefined,
      loadMore: async () => {},
      items: () =>
        options.buckets.includes('task')
          ? [
              {
                kind: 'task',
                id: 'task-1',
                data: {
                  type: 'document',
                  id: 'task-1',
                  name: 'Ship it',
                  subType: { type: 'task' },
                },
              },
            ]
          : [],
    }),
  }),
}));
vi.mock('@entity', () => ({
  Entity: {
    Icon: () => <span />,
    Title: (props: { entity: { name: string } }) => (
      <span>{props.entity.name}</span>
    ),
  },
  createEmailsInfiniteQuery: (
    _params: unknown,
    options: { disabled: () => boolean }
  ) => {
    sources.emailBrowse.push(!options.disabled());
    return {
      get data() {
        return options.disabled()
          ? []
          : [{ type: 'email', id: 'thread-1', name: 'Quarterly invoice' }];
      },
      isLoading: false,
      isPending: false,
    };
  },
}));
vi.mock('@queries/soup/search', () => ({
  validateSearchServiceText: (text: string) => text.length > 0,
  useSearchSoupQuery: (
    _request: unknown,
    options: () => { enabled: boolean }
  ) => {
    sources.emailSearch.push(options().enabled);
    return {
      get status() {
        return options().enabled ? 'success' : 'pending';
      },
      get data() {
        return options().enabled
          ? [{ type: 'email', id: 'thread-2', name: 'Invoice overdue' }]
          : undefined;
      },
      isFetching: false,
    };
  },
}));
vi.mock('@property/utils', () => ({ useSearchInputFocus: () => undefined }));

import { PropertyEntitySelector } from './PropertyEntitySelector';

afterEach(() => {
  cleanup();
  sources.emailBrowse.length = 0;
  sources.emailSearch.length = 0;
  sources.pinnedPeople.length = 0;
});

function renderSelector(specificEntityType: EntityType | EntityType[]) {
  render(() => (
    <PropertyEntitySelector
      config={{ isMultiSelect: false, specificEntityType, placeholder: 'Find' }}
      selectedOptions={() => new Set()}
      setSelectedOptions={() => {}}
    />
  ));
}

describe('an entity selector limited to several kinds', () => {
  it('browses and searches email threads when they are one of them', async () => {
    renderSelector(['TASK', 'THREAD']);
    expect(await screen.findByText('Ship it')).toBeTruthy();
    expect(screen.getByText('Quarterly invoice')).toBeTruthy();
    expect(sources.emailBrowse).toContain(true);
    expect(sources.emailSearch).toContain(true);

    fireEvent.input(screen.getByPlaceholderText('Find'), {
      target: { value: 'invoice' },
    });
    await waitFor(() =>
      expect(screen.getByText('Invoice overdue')).toBeTruthy()
    );
  });

  it('leaves email alone when threads are not among them', async () => {
    renderSelector(['TASK', 'CHANNEL']);
    expect(await screen.findByText('Ship it')).toBeTruthy();
    expect(screen.queryByText('Quarterly invoice')).toBeNull();
    expect(sources.emailBrowse).not.toContain(true);
    expect(sources.emailSearch).not.toContain(true);
  });

  it('offers pinned people when people are one of them', async () => {
    renderSelector(['TASK', 'USER']);
    expect(await screen.findByText('Pat')).toBeTruthy();
    expect(sources.pinnedPeople).toContain(true);
  });
});
