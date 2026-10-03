import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRow } from '../core/types';
import { RoutinesList } from './routines-list';

afterEach(cleanup);
const rows: RoutineRow[] = [
  {
    id: 'mine',
    name: 'Morning briefing',
    creator: 'You',
    createdAt: '',
    target: 'Macro',
    schedule: 'Weekdays at 9 AM',
    status: 'Active',
    enabled: true,
    editable: true,
  },
  {
    id: 'shared',
    name: 'Revenue signals',
    creator: 'Alex',
    createdAt: '',
    target: 'Finance agent',
    schedule: 'Every Friday',
    status: 'Paused',
    enabled: false,
    editable: false,
  },
];
function setup() {
  const props = {
    rows,
    scope: 'mine' as const,
    loading: false,
    error: false,
    onScope: vi.fn(),
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onRetry: vi.fn(),
  };
  render(() => <RoutinesList {...props} />);
  return props;
}
describe('routines list', () => {
  it('filters names, creators and agents without losing navigation', () => {
    const props = setup();
    fireEvent.input(screen.getByRole('searchbox'), {
      target: { value: 'finance' },
    });
    expect(screen.queryByText('Morning briefing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(props.onOpen).toHaveBeenCalledWith('shared', true);
    fireEvent.click(screen.getByRole('button', { name: /^Team$/ }));
    expect(props.onScope).toHaveBeenCalledWith('team');
  });
  it('offers activation controls only for owned routines', () => {
    const props = setup();
    const owned = screen.getByText('Morning briefing').closest('tr')!;
    const shared = screen.getByText('Revenue signals').closest('tr')!;
    fireEvent.click(within(owned).getByRole('button', { name: 'Disable' }));
    expect(props.onToggle).toHaveBeenCalledWith(rows[0]);
    expect(within(shared).queryByRole('button', { name: 'Enable' })).toBeNull();
  });
  it('opens an integration template as an editable creation draft', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Explore templates/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Integrations$/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /Spot revenue signals/ })
    );
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stripe-pulse', category: 'Integrations' })
    );
  });
});
