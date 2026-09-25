import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../../constants';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../../core/context';
import type { EntityProperty } from '../../types';
import { EntityEditor } from './EntityEditor';

const agentId = 'bot|00000000-0000-0000-0000-000000000123';
const userId = 'macro|alice@example.com';

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'alice@example.com',
  useUserId: () => () => 'macro|alice@example.com',
}));
vi.mock('@core/user', () => ({
  emailToId: (email: string) => `macro|${email}`,
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/user/util', () => ({
  idToEmail: (id: string) => id,
  idToDisplayName: (id: string) => id,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    isLoading: () => false,
    useList: () => ({
      items: () => [
        {
          kind: 'user',
          id: 'macro|alice@example.com',
          data: {
            id: 'macro|alice@example.com',
            name: 'Alice',
            email: 'alice@example.com',
          },
        },
      ],
    }),
  }),
}));
vi.mock('@entity', () => ({
  Entity: {},
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
  useCurrentTeamQuery: () => ({ data: null }),
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

function setup(existingTask: boolean, value = property) {
  const onSave = vi.fn(async () => undefined);
  const [editorOpen, setEditorOpen] = createSignal(true);
  const context: PropertyRootContextValue = {
    property: () => value,
    canEdit: () => true,
    editorOpen,
    openEditor: () => setEditorOpen(true),
    closeEditor: () => setEditorOpen(false),
    onSave,
  };
  render(() => (
    <PropertyRootContext.Provider value={context}>
      <EntityEditor
        selfFilter={
          existingTask ? { entityType: 'TASK', blockId: 'task-id' } : undefined
        }
      />
    </PropertyRootContext.Provider>
  ));
  return onSave;
}

afterEach(cleanup);

describe('assigning an agent through task properties', () => {
  it.each([false, true])(
    'saves the bot principal alongside the human assignee (existing task: %s)',
    async (existingTask) => {
      const onSave = setup(existingTask);
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Agent')).toBeTruthy();
      fireEvent.input(screen.getByPlaceholderText('Add assignees...'), {
        target: { value: 'research' },
      });
      await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
      fireEvent.click(screen.getByText('Research assistant'));
      expect(onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Dismiss'));
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledExactlyOnceWith(property, {
          valueType: 'ENTITY',
          refs: [
            { entity_id: userId, entity_type: 'USER' },
            { entity_id: agentId, entity_type: 'USER' },
          ],
        })
      );
    }
  );

  it('does not resave an unchanged assignment and can remove the agent', async () => {
    const assigned: EntityProperty = {
      ...property,
      value: [{ entity_id: agentId, entity_type: 'USER' }],
    };
    const unchanged = setup(true, assigned);
    fireEvent.click(screen.getByText('Dismiss'));
    expect(unchanged).not.toHaveBeenCalled();
    cleanup();
    const onSave = setup(true, assigned);
    fireEvent.click(screen.getByText('Research assistant'));
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(assigned, {
        valueType: 'ENTITY',
        refs: null,
      })
    );
  });

  it('keeps agents out of unrelated people properties', () => {
    setup(false, {
      ...property,
      propertyDefinitionId: 'custom-people-property',
    });
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Research assistant')).toBeNull();
  });
});
