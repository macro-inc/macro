import { beforeEach, expect, it, vi } from 'vitest';
import { openDatabaseRow } from './open-row';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const goToLocationFromParams = vi.fn(async () => {
    calls.push('goToLocation');
  });
  return {
    calls,
    goToLocationFromParams,
    openWithSplit: vi.fn(() => {
      calls.push('openWithSplit');
    }),
    getBlockHandle: vi.fn(async () => {
      calls.push('getBlockHandle');
      return { goToLocationFromParams };
    }),
    failure: vi.fn(),
  };
});
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    openWithSplit: mocks.openWithSplit,
    getOrchestrator: () => ({ getBlockHandle: mocks.getBlockHandle }),
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

const ROW = { databaseId: 'database', tableId: 'table', rowId: 'row' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
});

it('opens the database, then reveals the row in its table', async () => {
  await openDatabaseRow(ROW, {
    openInNewSplit: true,
    referredFrom: 'kommand-menu',
  });

  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    { type: 'database', id: 'database' },
    { activate: true, preferNewSplit: true, referredFrom: 'kommand-menu' }
  );
  expect(mocks.getBlockHandle).toHaveBeenCalledWith('database', 'database');
  expect(mocks.goToLocationFromParams).toHaveBeenCalledWith({
    tableId: 'table',
    rowId: 'row',
  });
  expect(mocks.calls).toEqual([
    'openWithSplit',
    'getBlockHandle',
    'goToLocation',
  ]);
  expect(mocks.failure).not.toHaveBeenCalled();
});

it('says so when the row cannot be revealed', async () => {
  mocks.goToLocationFromParams.mockRejectedValueOnce(new Error('gone'));

  await openDatabaseRow(ROW);

  expect(mocks.failure).toHaveBeenCalledOnce();
});
