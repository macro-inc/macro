import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type { EntityProperty } from '../types';
import { EntityPropertyEditor } from './entity-property-editor';

const outsiderId = 'macro|former@example.com';

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'viewer@example.com',
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({
      items: () => [],
      isLoading: () => false,
      isLoadingMore: () => false,
      hasMore: () => false,
      error: () => undefined,
      loadMore: async () => {},
    }),
  }),
}));
vi.mock('@core/user', () => ({
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/user/util', () => ({
  idToEmail: (id: string) => id.replace('macro|', ''),
  idToDisplayName: () => 'former',
}));
vi.mock('@queries/team/members', () => ({
  useTeamMembers: () => ({
    users: () => [],
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('../queries/agent-assignees', () => ({
  useAgentAssignees: () => () => [],
}));
vi.mock('@queries/contacts/use-directory', () => ({
  usePinnedContactUsers: (selected: () => Iterable<string>) => () => {
    const ids = [...selected()];
    return ids.includes(outsiderId)
      ? [{ id: outsiderId, email: 'former@example.com', name: 'Former Name' }]
      : [];
  },
}));
vi.mock('../selectors/entityUtils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useQuickAccessEntities: () => ({ items: () => [] }),
}));
vi.mock('@entity', () => ({
  createEmailsInfiniteQuery: () => ({
    data: [],
    isLoading: false,
    isPending: false,
  }),
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ status: 'pending', isFetching: false }),
}));
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: () => ({ icon: () => null }),
}));
vi.mock('../editors/selectors/OptionCheckBox', () => ({
  OptionCheckBox: (props: { checked: boolean }) => (
    <input type="checkbox" checked={props.checked} readOnly />
  ),
}));

const property: EntityProperty = {
  propertyId: 'assignees-property',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  displayName: 'Assignees',
  isMultiSelect: true,
  specificEntityType: 'USER',
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'ENTITY',
  value: [{ entity_id: outsiderId, entity_type: 'USER' }],
};

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('removed assignee lookup', () => {
  it('keeps a removed outsider searchable by their resolved display name', async () => {
    const [searchValue, setSearchValue] = createSignal('');
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    render(() => (
      <EntityPropertyEditor
        property={property}
        searchValue={searchValue}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedIndex}
        onSubmit={vi.fn()}
        onSave={vi.fn()}
        setKeybindings={() => {}}
        setPlaceholder={() => {}}
        selectedEntityCount={1}
      />
    ));

    fireEvent.click(screen.getByText('Former Name'));
    setSearchValue('Former Name');

    expect(await screen.findByText('Former Name')).toBeTruthy();
  });
});
