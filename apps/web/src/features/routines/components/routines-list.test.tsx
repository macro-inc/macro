import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRow } from '../core/types';
import { RoutinesList } from './routines-list';

vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

afterEach(cleanup);
const rows: RoutineRow[] = [
  {
    id: 'mine',
    name: 'Morning briefing',
    createdAt: '',
    when: 'Weekdays at 9:00 AM',
    does: 'Ask AI · Sonnet 5.5',
    group: 'schedule',
    lastRun: { at: '9:00 AM', failed: false, summary: 'Asked AI' },
    status: 'Active',
    enabled: true,
    editable: true,
  },
  {
    id: 'revenue',
    name: 'Revenue signals',
    createdAt: '',
    when: 'When: New email received',
    does: 'Ask AI · Finance agent',
    group: 'activity',
    lastRun: {
      at: 'Monday',
      failed: true,
      summary: 'Failed: No label named "Receipts" in this thread\'s inbox.',
    },
    status: 'Paused',
    enabled: false,
    editable: true,
  },
];
function setup(overrides: { rows?: RoutineRow[]; pendingId?: string } = {}) {
  const props = {
    rows,
    loading: false,
    error: false,
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(() => <RoutinesList {...props} />);
  return props;
}
describe('routines list', () => {
  it('filters routines and agents without losing navigation', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search routines' }));
    fireEvent.input(screen.getByRole('searchbox'), {
      target: { value: 'finance' },
    });
    expect(screen.queryByText('Morning briefing')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Revenue signals',
      })
    );
    expect(props.onOpen).toHaveBeenCalledWith('revenue');
    expect(props.onOpen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Morning briefing' }));
    expect(props.onOpen).toHaveBeenLastCalledWith('mine');
    expect(screen.queryByRole('button', { name: /^Team$/ })).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Routine ownership' })
    ).toBeNull();
  });
  it('toggles the enabled property without opening the routine', () => {
    const props = setup();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Enabled for Morning briefing',
        pressed: true,
      })
    );
    expect(props.onToggle).toHaveBeenCalledWith(rows[0]);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Enabled for Revenue signals',
        pressed: false,
      })
    );
    expect(props.onToggle).toHaveBeenLastCalledWith(rows[1]);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('prevents repeated changes while a property is saving', () => {
    const props = setup({ pendingId: 'mine' });
    const button = screen.getByRole('button', {
      name: 'Enabled for Morning briefing',
    });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('groups routines by what starts them and shows how each last ran', () => {
    setup();
    expect(screen.getByText('When something happens')).toBeTruthy();
    expect(screen.getByText('On a schedule')).toBeTruthy();
    expect(
      screen.getByText(
        'Monday · Failed: No label named "Receipts" in this thread\'s inbox.'
      )
    ).toBeTruthy();
    expect(screen.getByText('9:00 AM · Asked AI')).toBeTruthy();
  });
  it('shows only routines that are on under On', () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: /^On/ }));
    expect(
      screen.getByRole('button', { name: 'Morning briefing' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Revenue signals' })
    ).toBeNull();
  });
  it('opens a blank routine without a templates section', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create Routine' }));
    expect(props.onCreate).toHaveBeenCalledOnce();
    expect(screen.queryByText(/templates/i)).toBeNull();
  });
});
