import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutinesPage } from './RoutinesPage';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  create: vi.fn(),
  refetch: vi.fn(),
  status: 'success',
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@app/features/block-automation/component/AutomationComposer', () => ({
  setAutomationComposerOpen: mocks.create,
}));
vi.mock('@queries/agent-schedule/schedules', () => ({
  useSchedulesQuery: () => ({
    isPending: mocks.status === 'pending',
    isError: mocks.status === 'error',
    isSuccess: mocks.status === 'success',
    refetch: mocks.refetch,
    get data() {
      if (mocks.status !== 'success') throw new Error('Read unresolved data');
      return [
        {
          id: 'routine-1',
          name: 'Daily summary',
          enabled: true,
          schedule: '0 0 9 * * *',
          timezone: 'UTC',
          task: { user_prompt: 'Summarize updates' },
        },
      ];
    },
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = 'success';
});

describe('Routines page', () => {
  it('opens a saved routine in its editor and supports shift-click into a split', () => {
    render(() => <RoutinesPage />);
    fireEvent.click(screen.getByRole('button', { name: /Daily summary/ }), {
      shiftKey: true,
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'automation', id: 'routine-1' },
      { activate: true, preferNewSplit: true }
    );
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    expect(mocks.create).toHaveBeenCalledWith(true);
  });

  it('shows loading without reading unresolved query data', () => {
    mocks.status = 'pending';
    render(() => <RoutinesPage />);
    expect(screen.getByRole('status').textContent).toBe('Loading routines…');
    expect(screen.queryByText(/No routines yet/)).toBeNull();
  });

  it('offers retry instead of showing a failed request as an empty list', () => {
    mocks.status = 'error';
    render(() => <RoutinesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText(/No routines yet/)).toBeNull();
  });
});
