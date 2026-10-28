import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useFormDatabaseSync } from './forms-sync';

const state = vi.hoisted(() => ({
  change: undefined as ((change: { databaseId: string }) => void) | undefined,
  invalidateDatabase: vi.fn(),
  invalidatePreview: vi.fn(),
}));
vi.mock('@service-connection/client', () => ({
  useEntitySubscription: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('../client', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../preview', () => ({ invalidatePreview: state.invalidatePreview }));
vi.mock('./databases', () => ({
  invalidateDatabase: state.invalidateDatabase,
}));
vi.mock('./databases-sync', () => ({
  parseMessageData: vi.fn(),
  useDatabaseTableChanges: vi.fn(),
  useDatabaseMetadataChanges: (handler: typeof state.change) => {
    state.change = handler;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.change = undefined;
});

it('refreshes the database and linked preview for an editor when a peer renames it', () => {
  createRoot((dispose) => {
    useFormDatabaseSync(
      () => 'database-1',
      () => true,
      () => 'form-1'
    );
    state.change?.({ databaseId: 'unrelated' });
    expect(state.invalidateDatabase).not.toHaveBeenCalled();
    state.change?.({ databaseId: 'database-1' });
    expect(state.invalidateDatabase).toHaveBeenCalledExactlyOnceWith(
      'database-1'
    );
    expect(state.invalidatePreview).toHaveBeenCalledExactlyOnceWith('form-1');
    dispose();
  });
});

it('does not read the database for respondents, even if a stale ping arrives', () => {
  createRoot((dispose) => {
    useFormDatabaseSync(
      () => 'database-1',
      () => false,
      () => 'form-1'
    );
    state.change?.({ databaseId: 'database-1' });
    expect(state.invalidateDatabase).not.toHaveBeenCalled();
    expect(state.invalidatePreview).not.toHaveBeenCalled();
    dispose();
  });
});
