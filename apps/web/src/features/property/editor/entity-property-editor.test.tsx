import type { IUser } from '@core/user';
import type { ListNavActions } from '@core/util/useListKeyBindings';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
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
import type { EntityProperty } from '../types';
import { EntityPropertyEditor } from './entity-property-editor';

const fixture = vi.hoisted(() => ({ members: [] as IUser[] }));
vi.mock(
  '@ui',
  async () =>
    await import('@app/components/ui/components/CommandMenuPrimitives')
);
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'viewer@example.com',
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@core/user', () => ({
  useAugmentUserWithDmActivity: () => (user: IUser) => user,
}));
vi.mock('@core/user/util', () => ({
  idToEmail: (id: string) => id.replace('macro|', ''),
  idToDisplayName: (id: string) => id.replace('macro|', ''),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({
      items: () => [
        {
          kind: 'user',
          id: 'macro|outside@example.com',
          data: {
            id: 'macro|outside@example.com',
            name: 'Outside',
            email: 'outside@example.com',
          },
        },
      ],
    }),
  }),
}));
vi.mock('@entity', () => ({
  createEmailsInfiniteQuery: () => ({ data: [], isPending: false }),
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ status: 'pending' }),
}));
vi.mock('../queries/team-members', () => ({
  useTeamMembers: (enabled: () => boolean) => ({
    users: () => (enabled() ? fixture.members : []),
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('../queries/agent-assignees', () => ({
  useAgentAssignees: (enabled: () => boolean) => () =>
    enabled()
      ? [
          {
            id: 'bot|00000000-0000-0000-0000-000000000123',
            name: 'Research assistant',
            email: '@research',
          },
        ]
      : [],
}));
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: () => ({ icon: () => <span /> }),
}));
vi.mock('../editors/selectors/OptionCheckBox', () => ({
  OptionCheckBox: () => <span />,
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
  value: [],
};

function setup(value = property, count = 1) {
  const [current, setCurrent] = createSignal(value);
  const [query, setQuery] = createSignal('');
  const [index, setIndex] = createSignal(0);
  const [placeholder, setPlaceholder] = createSignal('');
  const onSubmit = vi.fn();
  const onSave = vi.fn();
  let bindings: ListNavActions | undefined;
  render(() => (
    <>
      <input
        aria-label="Search people"
        value={query()}
        placeholder={placeholder()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') bindings?.select?.(event);
          if (event.key === 'ArrowDown') bindings?.next?.();
        }}
      />
      <EntityPropertyEditor
        property={current()}
        searchValue={query}
        setSearchValue={setQuery}
        selectedIndex={index}
        setSelectedIndex={setIndex}
        onSubmit={onSubmit}
        onSave={onSave}
        setKeybindings={(next) => {
          bindings = next;
        }}
        setPlaceholder={setPlaceholder}
        selectedEntityCount={count}
      />
    </>
  ));
  return { onSubmit, onSave, setCurrent };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  fixture.members = [
    {
      id: 'macro|member@example.com',
      name: 'Member',
      email: 'member@example.com',
    },
  ];
});
afterEach(cleanup);

describe('modal Assignee selection', () => {
  it.each([0, 2])(
    'requires discovery in composer/bulk mode with %s entities and saves USER references',
    async (count) => {
      const { onSubmit } = setup(property, count);
      expect(screen.getByText('Member')).toBeTruthy();
      expect(screen.getByText('Research assistant')).toBeTruthy();
      expect(screen.queryByText('Outside')).toBeNull();
      const search = screen.getByRole('textbox');
      fireEvent.input(search, { target: { value: 'outside' } });
      await waitFor(() => expect(screen.queryByText('Member')).toBeNull());
      expect(screen.queryByText('Outside')).toBeNull();
      fireEvent.keyDown(search, { key: 'Enter' });
      fireEvent.click(await screen.findByText('Outside'));
      expect(onSubmit).toHaveBeenCalledWith({
        entity_id: 'macro|outside@example.com',
        entity_type: 'USER',
      });
    }
  );

  it('removes selected outsiders beyond the default result limit without rediscovery', () => {
    fixture.members = Array.from({ length: 60 }, (_, index) => ({
      id: `macro|member-${index}@example.com`,
      name: `Member ${index}`,
      email: `member-${index}@example.com`,
    }));
    const { onSave } = setup({
      ...property,
      value: [{ entity_id: 'macro|outside@example.com', entity_type: 'USER' }],
    });
    fireEvent.click(screen.getByText('Outside'));
    expect(screen.queryByText('Outside')).toBeNull();
    expect(onSave).toHaveBeenCalledWith(
      { valueType: 'ENTITY', refs: null },
      expect.any(MouseEvent)
    );
  });

  it('saves agents alongside people in a single-entity draft', () => {
    const { onSave } = setup({
      ...property,
      value: [{ entity_id: 'macro|member@example.com', entity_type: 'USER' }],
    });
    fireEvent.click(screen.getByText('Research assistant'));
    expect(onSave).toHaveBeenCalledWith(
      {
        valueType: 'ENTITY',
        refs: [
          { entity_id: 'macro|member@example.com', entity_type: 'USER' },
          {
            entity_id: 'bot|00000000-0000-0000-0000-000000000123',
            entity_type: 'USER',
          },
        ],
      },
      expect.any(MouseEvent)
    );
  });

  it('keeps company owners team-only and resets discovery after switching properties', () => {
    const { setCurrent } = setup();
    fireEvent.click(screen.getByText('Find other people…'));
    expect(screen.getByText('Outside')).toBeTruthy();
    setCurrent({
      ...property,
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
    });
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.queryByText('Outside')).toBeNull();
    expect(screen.queryByText('Research assistant')).toBeNull();
    expect(screen.queryByText('Find other people…')).toBeNull();
    setCurrent({ ...property, propertyDefinitionId: 'custom-people' });
    expect(screen.getByText('Outside')).toBeTruthy();
    setCurrent(property);
    expect(screen.queryByText('Outside')).toBeNull();
    expect(screen.getByText('Find other people…')).toBeTruthy();
  });
});
