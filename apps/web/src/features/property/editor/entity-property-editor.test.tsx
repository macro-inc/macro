import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import { PropertiesProvider } from '../context/PropertiesContext';
import { PropertyRootContext } from '../core/context';
import type { EntityProperty } from '../types';
import { EntityPropertyEditor } from './entity-property-editor';

const outsiderId = 'macro|former@example.com';
const viewerId = 'macro|viewer@example.com';
const teammateId = 'macro|teammate@example.com';
const team = vi.hoisted(() => ({ users: [] as string[] }));

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
  idToDisplayName: (id: string) => {
    if (id === 'macro|viewer@example.com') return 'Viewer';
    if (id === 'macro|teammate@example.com') return 'Teammate';
    return 'former';
  },
}));
vi.mock('@queries/team/members', () => ({
  useTeamMembers: () => ({
    users: () =>
      team.users.map((id) => ({
        id,
        email: id.replace('macro|', ''),
        name: id === 'macro|viewer@example.com' ? 'Viewer' : 'Teammate',
      })),
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

function renderEditor(value: EntityProperty) {
  const [searchValue, setSearchValue] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const onSave = vi.fn();
  render(() => (
    <PropertiesProvider
      entityType="TASK"
      canEdit
      properties={() => [value]}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{
        saveProperty: async () => {},
        saveDate: async () => {},
      }}
    >
      <PropertyRootContext.Provider
        value={{
          property: () => value,
          pickedEntityName: () => undefined,
          canEdit: () => true,
          editorOpen: () => true,
          openEditor: () => {},
          closeEditor: () => {},
        }}
      >
        <EntityPropertyEditor
          property={value}
          searchValue={searchValue}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          onSubmit={vi.fn()}
          onSave={onSave}
          setKeybindings={() => {}}
          setPlaceholder={() => {}}
          selectedEntityCount={1}
          savedValueState="known"
        />
      </PropertyRootContext.Provider>
    </PropertiesProvider>
  ));
  return { onSave, setSearchValue };
}

beforeEach(() => {
  team.users = [];
});

describe('removed assignee lookup', () => {
  it('keeps a removed outsider searchable by their resolved display name', async () => {
    const { setSearchValue } = renderEditor(property);

    fireEvent.click(screen.getByText('Former Name'));
    setSearchValue('Former Name');

    expect(await screen.findByText('Former Name')).toBeTruthy();
  });
});

describe('assigning yourself', () => {
  const unassigned: EntityProperty = { ...property, value: [] };

  it('lists you without a team and saves you as the assignee', () => {
    const { onSave } = renderEditor(unassigned);

    expect(screen.getAllByText('Viewer')).toHaveLength(1);
    fireEvent.click(screen.getByText('Viewer'));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      {
        valueType: 'ENTITY',
        refs: [{ entity_id: viewerId, entity_type: 'USER' }],
      },
      expect.anything()
    );
  });

  it('lists you once beside your team', () => {
    team.users = [teammateId, viewerId];
    renderEditor(unassigned);

    expect(screen.getAllByText('Viewer')).toHaveLength(1);
    expect(screen.getAllByText('Teammate')).toHaveLength(1);
  });
});
