/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssigneeDiscoveryControls,
  useAssigneePicker,
} from './assignee-picker';

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => [
    { id: 'me', name: 'Me' },
    { id: 'teammate', name: 'Teammate' },
    { id: 'outsider', name: 'Outsider' },
    { id: 'agent', name: 'Agent' },
  ],
}));
vi.mock('@property/queries/team-members', () => ({
  useTeamMembers: () => ({
    users: () => [{ id: 'teammate', name: 'Teammate' }],
    isLoading: () => false,
    isError: () => false,
  }),
}));

const Picker = () => {
  const [selected, setSelected] = createSignal(['outsider']);
  const picker = useAssigneePicker(selected, () => true);
  return (
    <>
      <div data-testid="selection">{selected().join(',')}</div>
      <For each={picker.options()}>
        {(option) => (
          <button
            type="button"
            onClick={() =>
              setSelected((ids) =>
                ids.includes(option.id)
                  ? ids.filter((id) => id !== option.id)
                  : [...ids, option.id]
              )
            }
          >
            {option.label}
          </button>
        )}
      </For>
      <AssigneeDiscoveryControls discovery={picker} />
      <button type="button" onClick={() => picker.setDiscovering(false)}>
        Close filter
      </button>
    </>
  );
};

afterEach(cleanup);

describe('assignee discovery', () => {
  it('keeps selected outsiders in the team list and discovers other contacts without changing selection', () => {
    render(() => <Picker />);
    expect(screen.getByRole('button', { name: 'Outsider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Teammate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agent' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Find other people…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByTestId('selection').textContent).toBe('outsider,agent');

    fireEvent.click(
      screen.getByRole('button', { name: 'Back to team members' })
    );
    expect(screen.getByRole('button', { name: 'Agent' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Outsider' }));
    expect(screen.queryByRole('button', { name: 'Outsider' })).toBeNull();
    expect(screen.getByTestId('selection').textContent).toBe('agent');

    fireEvent.click(screen.getByRole('button', { name: 'Find other people…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close filter' }));
    expect(
      screen.getByRole('button', { name: 'Find other people…' })
    ).toBeTruthy();
  });
});
