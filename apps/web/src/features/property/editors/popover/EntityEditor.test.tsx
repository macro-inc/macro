import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../../constants';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../../core/context';
import type { EntityProperty } from '../../types';
import { EntityEditor, EntitySheetEditor } from './EntityEditor';

const agentId = 'bot|00000000-0000-0000-0000-000000000123';
const userId = 'macro|alice@example.com';
const roster = vi.hoisted(() => ({ includeOutside: false }));

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'alice@example.com',
  useUserId: () => () => 'macro|alice@example.com',
}));
vi.mock('@core/user', () => ({
  emailToId: (email: string) => `macro|${email}`,
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/user/util', () => ({
  idToEmail: (id: string) => id.replace('macro|', ''),
  idToDisplayName: (id: string) => {
    if (id === 'macro|alice@example.com') return 'Alice';
    if (id === 'macro|teammate@example.com') return 'Teammate';
    return id.replace('macro|', '');
  },
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    isLoading: () => false,
    useList: (...buckets: string[]) => ({
      items: () =>
        buckets.includes('initiative')
          ? [
              {
                kind: 'initiative',
                id: 'project-launch',
                data: {
                  type: 'initiative',
                  id: 'project-launch',
                  name: 'Launch',
                },
              },
            ]
          : [
              {
                kind: 'user',
                id: 'macro|alice@example.com',
                data: {
                  id: 'macro|alice@example.com',
                  name: 'Alice',
                  email: 'alice@example.com',
                },
              },
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
  Entity: {
    Icon: () => <span />,
    Title: (props: { entity: { name: string } }) => (
      <span>{props.entity.name}</span>
    ),
  },
  isTaskEntity: () => false,
  createEmailsInfiniteQuery: () => ({
    data: [],
    isLoading: false,
    isPending: false,
  }),
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ status: 'pending', isFetching: false }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      members: [
        { user_id: 'macro|alice@example.com' },
        { user_id: 'macro|teammate@example.com' },
        ...(roster.includeOutside
          ? [{ user_id: 'macro|outside@example.com' }]
          : []),
      ],
    },
  }),
}));
vi.mock('../../queries/agent-assignees', () => ({
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
vi.mock('../../utils', async () => ({
  ...(await import('../../utils/typeGuards')),
  useSearchInputFocus: () => undefined,
}));
vi.mock('../selectors/OptionCheckBox', () => ({
  OptionCheckBox: (props: { checked: boolean }) => (
    <input type="checkbox" checked={props.checked} readOnly />
  ),
}));
vi.mock('@components/app/mobile/PickerSheet', () => ({
  PickerSheet: {
    Root: (props: ParentProps<{ open: boolean }>) => (
      <Show when={props.open}>
        <div role="dialog">{props.children}</div>
      </Show>
    ),
    Header: (props: { onDone: () => void }) => (
      <button onClick={props.onDone}>Done</button>
    ),
    Body: (props: ParentProps) => <>{props.children}</>,
  },
}));
vi.mock('./EditorPopover', () => ({
  EditorPopover: (props: ParentProps<{ onClose: () => void }>) => (
    <div role="dialog">
      {props.children}
      <button onClick={props.onClose}>Dismiss</button>
    </div>
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
  value: [{ entity_id: userId, entity_type: 'USER' }],
};

function setup(
  selfFilter?: { entityType: EntityType; blockId?: string },
  value = property,
  Editor = EntityEditor
) {
  const onSave = vi.fn(async () => undefined);
  const [editorOpen, setEditorOpen] = createSignal(true);
  const context: PropertyRootContextValue = {
    property: () => value,
    pickedEntityName: () => undefined,
    canEdit: () => true,
    editorOpen,
    openEditor: () => setEditorOpen(true),
    closeEditor: () => setEditorOpen(false),
    onSave,
  };
  render(() => (
    <PropertyRootContext.Provider value={context}>
      <Editor selfFilter={selfFilter} />
    </PropertyRootContext.Provider>
  ));
  return onSave;
}

beforeAll(() => {
  // A key press puts the list in keyboard mode, which scrolls its row into view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  roster.includeOutside = false;
});

describe('assigning an agent through task and project properties', () => {
  it.each([
    { Editor: EntityEditor, search: false },
    { Editor: EntitySheetEditor, search: false },
    { Editor: EntityEditor, search: true },
    { Editor: EntitySheetEditor, search: true },
  ])(
    'keeps selected people above agents for keyboard assignment (search: $search)',
    async ({ Editor, search }) => {
      const onSave = setup(undefined, property, Editor);
      if (search) {
        const input = screen.getByPlaceholderText('Search assignees...');
        fireEvent.input(input, { target: { value: 'no-match' } });
        await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
        fireEvent.input(input, { target: { value: 'a' } });
        await screen.findByText('Alice');
      }
      fireEvent.keyDown(screen.getByPlaceholderText('Search assignees...'), {
        key: 'ArrowDown',
      });
      fireEvent.keyDown(screen.getByPlaceholderText('Search assignees...'), {
        key: 'Enter',
      });
      fireEvent.click(
        screen.getByText(Editor === EntitySheetEditor ? 'Done' : 'Dismiss')
      );
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledExactlyOnceWith(
          property,
          {
            valueType: 'ENTITY',
            refs: [
              { entity_id: userId, entity_type: 'USER' },
              { entity_id: agentId, entity_type: 'USER' },
            ],
          },
          new Map([[agentId, 'Research assistant']])
        )
      );
    }
  );
  it.each([
    { name: 'new task', selfFilter: undefined },
    {
      name: 'existing task',
      selfFilter: { entityType: 'TASK' as const, blockId: 'task-id' },
    },
    { name: 'new project', selfFilter: { entityType: 'INITIATIVE' as const } },
    {
      name: 'existing project',
      selfFilter: { entityType: 'INITIATIVE' as const, blockId: 'project-id' },
    },
  ])(
    'saves the bot principal alongside the human assignee in a $name',
    async ({ selfFilter }) => {
      const onSave = setup(selfFilter);
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Agent')).toBeTruthy();
      expect(
        screen.queryByText(
          'Agents assigned to this project automatically take on tasks created in or moved into it. Use a shared team agent for tasks added by teammates.'
        ) !== null
      ).toBe(selfFilter?.entityType === 'INITIATIVE');
      fireEvent.input(screen.getByPlaceholderText('Search assignees...'), {
        target: { value: 'research' },
      });
      await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
      fireEvent.click(screen.getByText('Research assistant'));
      expect(onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Dismiss'));
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledExactlyOnceWith(
          property,
          {
            valueType: 'ENTITY',
            refs: [
              { entity_id: userId, entity_type: 'USER' },
              { entity_id: agentId, entity_type: 'USER' },
            ],
          },
          new Map([[agentId, 'Research assistant']])
        )
      );
    }
  );

  it.each(['TASK', 'INITIATIVE'] as const)(
    'does not resave an unchanged assignment and can remove the agent from %s',
    async (entityType) => {
      const assigned: EntityProperty = {
        ...property,
        value: [{ entity_id: agentId, entity_type: 'USER' }],
      };
      const unchanged = setup({ entityType, blockId: 'entity-id' }, assigned);
      fireEvent.click(screen.getByText('Dismiss'));
      expect(unchanged).not.toHaveBeenCalled();
      cleanup();
      const onSave = setup({ entityType, blockId: 'entity-id' }, assigned);
      fireEvent.click(screen.getByText('Research assistant'));
      fireEvent.click(screen.getByText('Dismiss'));
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledExactlyOnceWith(
          assigned,
          { valueType: 'ENTITY', refs: null },
          new Map([[agentId, 'Research assistant']])
        )
      );
    }
  );

  it('keeps agents out of unrelated people properties', () => {
    setup(
      { entityType: 'INITIATIVE', blockId: 'project-id' },
      {
        ...property,
        propertyDefinitionId: 'custom-people-property',
      }
    );
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Research assistant')).toBeNull();
    expect(
      screen.queryByText(
        'Agents assigned to this project automatically take on tasks created in or moved into it. Use a shared team agent for tasks added by teammates.'
      )
    ).toBeNull();
  });
});

describe('team-first assignees', () => {
  it.each([EntityEditor, EntitySheetEditor])(
    'keeps the search field and staged selections across people-view navigation',
    async (Editor) => {
      const assigned: EntityProperty = {
        ...property,
        value: [
          { entity_id: userId, entity_type: 'USER' },
          { entity_id: agentId, entity_type: 'USER' },
        ],
      };
      const onSave = setup(undefined, assigned, Editor);
      const input = screen.getByPlaceholderText('Search assignees...');
      input.focus();
      expect(screen.getByText('Teammate')).toBeTruthy();
      expect(screen.queryByText('Outside')).toBeNull();
      fireEvent.click(
        screen.getByRole('button', { name: 'Find other people…' })
      );
      expect(screen.getByPlaceholderText('Search other people...')).toBe(input);
      expect(document.activeElement).toBe(input);
      await waitFor(() => {
        expect(screen.queryByText('Teammate')).toBeNull();
        expect(screen.queryByText('Alice')).toBeNull();
        expect(screen.queryByText('Research assistant')).toBeNull();
      });
      fireEvent.click(await screen.findByText('Outside'));
      fireEvent.input(input, { target: { value: 'outside' } });
      fireEvent.click(
        screen.getByRole('button', { name: 'Back to assignees' })
      );
      expect(screen.getByPlaceholderText('Search assignees...')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect((input as HTMLInputElement).value).toBe('');
      expect(await screen.findByText('Research assistant')).toBeTruthy();
      await waitFor(() => expect(screen.getByText('Outside')).toBeTruthy());
      fireEvent.click(
        screen.getByText(Editor === EntitySheetEditor ? 'Done' : 'Dismiss')
      );
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith(
          assigned,
          {
            valueType: 'ENTITY',
            refs: [
              { entity_id: userId, entity_type: 'USER' },
              { entity_id: agentId, entity_type: 'USER' },
              { entity_id: 'macro|outside@example.com', entity_type: 'USER' },
            ],
          },
          new Map([['macro|outside@example.com', 'Outside']])
        )
      );
    }
  );

  it('returns from empty discovery without changing assignments', async () => {
    roster.includeOutside = true;
    const onSave = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Find other people…' }));
    expect(screen.getByRole('status').textContent).toBe(
      'No other people available.'
    );
    await waitFor(() => {
      expect(screen.queryByText('Teammate')).toBeNull();
      expect(screen.queryByText('Outside')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to assignees' }));
    expect(await screen.findByText('Teammate')).toBeTruthy();
    expect(screen.getByText('outside@example.com')).toBeTruthy();
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes a selected outsider missing from contacts without discovery', async () => {
    const assigned: EntityProperty = {
      ...property,
      value: [{ entity_id: 'macro|former@example.com', entity_type: 'USER' }],
    };
    const onSave = setup(undefined, assigned);
    fireEvent.click(screen.getByText('former@example.com'));
    expect(screen.queryByText('former@example.com')).toBeNull();
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        assigned,
        { valueType: 'ENTITY', refs: null },
        new Map([['macro|former@example.com', 'former@example.com']])
      )
    );
  });

  it('reaches discovery with the keyboard after a team-only search has no matches', async () => {
    setup(undefined, { ...property, value: [] });
    const input = screen.getByPlaceholderText('Search assignees...');
    fireEvent.input(input, { target: { value: 'outside' } });
    await waitFor(() => expect(screen.queryByText('Teammate')).toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Outside')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Back to assignees' })
    ).toBeTruthy();
  });

  it('keeps custom people fields broad and company owners strictly team-only', () => {
    setup(undefined, { ...property, propertyDefinitionId: 'custom-people' });
    expect(screen.getByText('Outside')).toBeTruthy();
    cleanup();
    setup(undefined, {
      ...property,
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
    });
    expect(screen.getByText('Teammate')).toBeTruthy();
    expect(screen.queryByText('Outside')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Find other people…' })
    ).toBeNull();
  });
});
describe('people in a picker sheet', () => {
  it('drops the picks on Escape and saves them on Done', async () => {
    const dropped = setup(undefined, property, EntitySheetEditor);
    fireEvent.click(screen.getByText('Research assistant'));
    fireEvent.keyDown(screen.getByPlaceholderText('Search assignees...'), {
      key: 'Escape',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dropped).not.toHaveBeenCalled();
    cleanup();

    const onSave = setup(undefined, property, EntitySheetEditor);
    fireEvent.click(screen.getByText('Research assistant'));
    fireEvent.click(screen.getByText('Done'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        property,
        {
          valueType: 'ENTITY',
          refs: [
            { entity_id: userId, entity_type: 'USER' },
            { entity_id: agentId, entity_type: 'USER' },
          ],
        },
        new Map([[agentId, 'Research assistant']])
      )
    );
  });
});

describe('the Project property', () => {
  const project: EntityProperty = {
    ...property,
    propertyId: 'project-property',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
    displayName: 'Project',
    isMultiSelect: false,
    specificEntityType: 'INITIATIVE',
    value: [{ entity_id: 'project-launch', entity_type: 'INITIATIVE' }],
  };

  it('saves a picked project with the name the picker showed', async () => {
    const unassigned: EntityProperty = { ...project, value: [] };
    const onSave = setup(
      { entityType: 'TASK', blockId: 'task-id' },
      unassigned
    );
    fireEvent.click(screen.getByText('Launch'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        unassigned,
        {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'project-launch', entity_type: 'INITIATIVE' }],
        },
        new Map([['project-launch', 'Launch']])
      )
    );
  });

  it('clears the project when the selected project is clicked again', async () => {
    const onSave = setup({ entityType: 'TASK', blockId: 'task-id' }, project);
    fireEvent.click(screen.getByText('Launch'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        project,
        { valueType: 'ENTITY', refs: null },
        new Map([['project-launch', 'Launch']])
      )
    );
  });
});
