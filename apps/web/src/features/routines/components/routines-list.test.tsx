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
    whenKind: 'schedule',
    does: 'Sum up my day',
    ai: 'Ask AI',
    group: 'schedule',
    lastRun: { at: '9:00 AM', outcome: 'succeeded', summary: 'Asked AI' },
    status: 'Active',
    enabled: true,
    editable: true,
  },
  {
    id: 'revenue',
    name: 'Revenue signals',
    createdAt: '',
    when: 'New email received',
    whenKind: 'email',
    does: 'Invoice, Newsletter · 4 actions',
    ai: 'AI picks',
    group: 'activity',
    lastRun: {
      at: 'Monday',
      outcome: 'failed',
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
      target: { value: 'invoice' },
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
    const on = screen.getByRole('switch', {
      name: 'Enabled for Morning briefing',
    }) as HTMLInputElement;
    expect(on.checked).toBe(true);
    fireEvent.click(on);
    expect(props.onToggle).toHaveBeenCalledWith(rows[0]);
    const off = screen.getByRole('switch', {
      name: 'Enabled for Revenue signals',
    }) as HTMLInputElement;
    expect(off.checked).toBe(false);
    fireEvent.click(off);
    expect(props.onToggle).toHaveBeenLastCalledWith(rows[1]);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('prevents repeated changes while a property is saving', () => {
    const props = setup({ pendingId: 'mine' });
    const toggle = screen.getByRole('switch', {
      name: 'Enabled for Morning briefing',
    }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('groups routines by what starts them and shows how each last ran', () => {
    setup();
    const groups = screen
      .getAllByRole('row')
      .filter((row) =>
        /When something happens|On a schedule/.test(row.textContent ?? '')
      );
    expect(groups.map((row) => row.textContent)).toEqual([
      'When something happens1',
      'On a schedule1',
    ]);
    // How AI takes part reads as a chip before what the routine does.
    expect(screen.getByText('AI picks')).toBeTruthy();
    expect(screen.getByText('Invoice, Newsletter · 4 actions')).toBeTruthy();
    expect(screen.getByText('Ask AI')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Routines' });
    expect(table.textContent).toContain(
      'Monday · Failed: No label named "Receipts" in this thread\'s inbox.'
    );
    expect(table.textContent).toContain('9:00 AM · Asked AI');
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
