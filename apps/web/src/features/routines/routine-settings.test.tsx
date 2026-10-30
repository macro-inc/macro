import { SettingsSheetContext } from '@app/features/settings/primitives';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoutineListSource } from './context/routine-sources';
import { RoutineSettings } from './routine-settings';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  openAgentsPage: vi.fn(),
  popoverSplit: vi.fn(),
}));
const layout = { openWithSplit: vi.fn(), popoverSplit: mocks.popoverSplit };

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
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => layout,
}));
vi.mock('@app/features/settings/context/mobile-settings', () => ({
  useMobileSettings: () => ({ close: mocks.close }),
}));
vi.mock('@app/features/agents-view/primitives/open-page', () => ({
  openAgentsPage: mocks.openAgentsPage,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('./queries/routine-target-display', () => ({
  createRoutineTargetDisplay: () => ({
    targetLabel: () => 'Sonnet 5.5',
    targetModel: () => undefined,
  }),
}));
vi.mock('./queries/routine-sources', () => ({
  createRoutineListSource: (): RoutineListSource => ({
    routines: () => [
      {
        id: 'briefing',
        name: 'Morning briefing',
        ownerId: 'macro|owner@example.com',
        createdAt: '2026-10-01T09:00:00Z',
        enabled: true,
        revision: 1,
        configurationKey: 'briefing',
      },
    ],
    loading: () => false,
    error: () => false,
    refresh: async () => undefined,
    setEnabled: vi.fn(),
    pendingId: () => undefined,
  }),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('routine settings', () => {
  it('closes the sheet and opens the tapped routine', () => {
    render(() => (
      <SettingsSheetContext.Provider value={true}>
        <RoutineSettings />
      </SettingsSheetContext.Provider>
    ));
    expect(screen.queryByRole('heading', { name: 'Routines' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Morning briefing' }));
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.openAgentsPage).toHaveBeenCalledWith(layout, 'routines', {
      routineId: 'briefing',
    });
  });

  it('opens the composer and the created routine from Create', () => {
    render(() => <RoutineSettings />);
    expect(screen.getAllByRole('heading', { name: 'Routines' })).toHaveLength(
      1
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Routine' }));
    expect(mocks.close).toHaveBeenCalledOnce();
    const content = mocks.popoverSplit.mock.calls[0][0];
    expect(content).toMatchObject({ type: 'component', id: 'routine-compose' });
    content.params.onCreated('created');
    expect(mocks.openAgentsPage).toHaveBeenCalledWith(layout, 'routines', {
      routineId: 'created',
    });
  });
});
