import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openBulkEditModal: vi.fn(),
  bulkDeleteMutateAsync: vi.fn(async () => []),
}));

// The action pulls in the bulk-edit modal, split manager and toast at module
// scope; only `canExecute` is under test, and it touches none of them.
vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: mocks.openBulkEditModal,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  globalRemoveFromSplitHistory: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), dismiss: vi.fn() },
}));
// The real barrel reaches the query clients, which open websockets under jsdom.
vi.mock('@entity', () => ({
  createBulkDeleteDssItemsMutation: () => ({
    mutateAsync: mocks.bulkDeleteMutateAsync,
  }),
}));
vi.mock('../utils', () => ({
  restoreSoupFocus: vi.fn(),
  trashEmails: vi.fn(),
}));

import { makeDeleteAction } from './make-delete-action';

const ME = 'macro|me@macro.com';

const entity = (
  type: EntityData['type'],
  overrides: Partial<EntityData> = {}
) =>
  ({ type, id: 'e1', name: 'Thing', ownerId: ME, ...overrides }) as EntityData;

const { canExecute, execute } = makeDeleteAction({ userId: () => ME });

beforeEach(() => vi.clearAllMocks());

describe('makeDeleteAction.execute', () => {
  const reminder = entity('reminder', { ownerId: '' });

  it('deletes a reminder without a confirmation step', async () => {
    await execute([reminder]);

    expect(mocks.bulkDeleteMutateAsync).toHaveBeenCalledWith([reminder]);
    expect(mocks.openBulkEditModal).not.toHaveBeenCalled();
  });

  it('still confirms for everything else', async () => {
    await execute([entity('document')]);

    expect(mocks.openBulkEditModal).toHaveBeenCalledOnce();
  });

  // A mixed selection confirms only the entities the modal actually lists;
  // the reminders in it are already gone by then.
  it('splits a mixed selection, confirming only the non-reminders', async () => {
    const doc = entity('document', { id: 'doc-1' });

    await execute([reminder, doc]);

    expect(mocks.bulkDeleteMutateAsync).toHaveBeenCalledWith([reminder]);
    expect(mocks.openBulkEditModal).toHaveBeenCalledWith(
      expect.objectContaining({ entities: [doc] })
    );
  });
});

describe('makeDeleteAction.canExecute', () => {
  it('allows deleting entities the caller owns', () => {
    expect(canExecute(entity('document'))).toBe(true);
    expect(canExecute(entity('chat'))).toBe(true);
  });

  it('refuses entities owned by someone else', () => {
    expect(canExecute(entity('document', { ownerId: 'macro|other' }))).toBe(
      false
    );
  });

  it('refuses channels and channel rows outright', () => {
    expect(canExecute(entity('channel'))).toBe(false);
    expect(canExecute(entity('channel_message'))).toBe(false);
    expect(canExecute(entity('channel_thread'))).toBe(false);
  });

  // Reminders carry no owner id, so the ownership check would reject them.
  // The API only ever returns the caller's own, so there is nobody else's to
  // delete.
  it('allows deleting a reminder despite it carrying no owner id', () => {
    expect(canExecute(entity('reminder', { ownerId: '' }))).toBe(true);
  });
});
