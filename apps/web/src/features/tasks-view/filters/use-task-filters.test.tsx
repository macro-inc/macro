import { Key } from '@solid-primitives/keyed';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_VIEWER } from './task-facets';
import { useTaskFilters } from './use-task-filters';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => [
    {
      id: 'macro|viewer@example.com',
      name: 'Viewer',
      email: 'viewer@example.com',
    },
    {
      id: 'macro|outside@example.com',
      name: 'Outside',
      email: 'outside@example.com',
    },
  ],
}));
vi.mock('@property/queries/team-members', () => ({
  useTeamMembers: () => ({
    users: () => [
      {
        id: 'macro|member@example.com',
        name: 'Member',
        email: 'member@example.com',
      },
    ],
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('@property/tags/use-tag-filter-group', () => ({
  useTagFilterGroup: () => () => ({ id: 'tags', label: 'Tags', options: [] }),
}));
vi.mock('@property/component/propertyValue', () => ({
  PropertyValueIcon: () => <span />,
}));
vi.mock('../queries/ai-task-filter-plan', () => ({
  requestAiTaskFilterPlan: vi.fn(),
}));
vi.mock('../tasks-view-context', () => ({
  useTasksView: () => {
    const [state, setState] = createStore({
      facets: {} as Record<string, string[]>,
      search: '',
    });
    return {
      state,
      setState,
      setFacets: (facets: Record<string, string[]>) =>
        setState('facets', facets),
      savedViews: {},
    };
  },
}));

function Picker() {
  const filters = useTaskFilters();
  return (
    <>
      <Key
        each={filters
          .groups()
          .filter(
            (group) => group.id === 'assignees' || group.id === 'created-by'
          )}
        by="id"
      >
        {(group) => (
          <section aria-label={group().label}>
            <For each={group().options}>
              {(option) => (
                <button
                  aria-pressed={filters.isSelected(group().id, option.id)}
                  onClick={() =>
                    filters.setSelected(
                      group().id,
                      option.id,
                      !filters.isSelected(group().id, option.id)
                    )
                  }
                >
                  {option.label}
                </button>
              )}
            </For>
            <Show when={group().action}>
              {(action) => (
                <button onClick={action().onSelect}>{action().label}</button>
              )}
            </Show>
            {group().footer}
          </section>
        )}
      </Key>
      <button onClick={filters.resetAssigneeDiscovery}>Close filters</button>
      <output>{JSON.stringify(filters.selectedIds('assignees'))}</output>
    </>
  );
}

afterEach(cleanup);

describe('task view assignee discovery', () => {
  it('limits only Assignees to the roster and preserves discovered selections after closing', () => {
    render(() => <Picker />);
    const assignees = screen.getByRole('region', { name: 'Assignee' });
    const creators = screen.getByRole('region', { name: 'Created by' });
    expect(assignees.textContent).toContain('Member');
    expect(assignees.textContent).not.toContain('Outside');
    expect(creators.textContent).toContain('Outside');
    fireEvent.click(screen.getByRole('button', { name: 'Find other people…' }));
    fireEvent.click(within(assignees).getByRole('button', { name: 'Outside' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    const retainedAssignees = screen.getByRole('region', { name: 'Assignee' });
    expect(retainedAssignees.textContent).toContain('Outside');
    expect(screen.getByRole('status').textContent).toContain(
      'macro|outside@example.com'
    );
    fireEvent.click(
      within(retainedAssignees).getByRole('button', { name: 'Outside' })
    );
    expect(screen.getByRole('status').textContent).toBe('[]');
  });

  it('keeps semantic Me distinct from the fixed current user during discovery', () => {
    render(() => <Picker />);
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Assignee' })).getByRole(
        'button',
        { name: /^Me$/ }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find other people…' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to team members' })
    );
    expect(screen.getByRole('status').textContent).toBe(
      JSON.stringify([TASK_VIEWER])
    );
    expect(
      within(screen.getByRole('region', { name: 'Assignee' })).getByRole(
        'button',
        { name: 'Viewer (me)' }
      )
    ).toBeTruthy();
  });
});
