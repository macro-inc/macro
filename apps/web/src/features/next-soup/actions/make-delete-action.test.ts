import { BulkDeleteFailure } from '@app/features/entity/queries/bulk-delete-result';
import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openBulkEditModal: vi.fn(),
  bulkDeleteMutateAsync: vi.fn(async () => []),
  splitManager: undefined as object | undefined,
  removeHistory: vi.fn(),
  success: vi.fn(),
  restoreFocus: vi.fn(),
  trashEmails: vi.fn(),
}));

// The action pulls in the bulk-edit modal, split manager and toast at module
// scope; only `canExecute` is under test, and it touches none of them.
vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: mocks.openBulkEditModal,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => mocks.splitManager,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  globalRemoveFromSplitHistory: mocks.removeHistory,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: vi.fn(), dismiss: vi.fn() },
}));
// The real barrel reaches the query clients, which open websockets under jsdom.
vi.mock('@entity', () => ({
  isEmailEntity: (entity: EntityData) => entity.type === 'email',
  createBulkDeleteDssItemsMutation: () => ({
    mutateAsync: mocks.bulkDeleteMutateAsync,
  }),
}));
vi.mock('../utils', () => ({
  restoreSoupFocus: mocks.restoreFocus,
  trashEmails: mocks.trashEmails,
}));

import type { SoupRow } from '../create-soup-state';
import type { EntityActionListState } from './entity-action-context';
import { makeDeleteAction } from './make-delete-action';

const ME = 'macro|me@macro.com';

const entity = (
  type: EntityData['type'],
  overrides: Partial<EntityData> = {}
) =>
  ({ type, id: 'e1', name: 'Thing', ownerId: ME, ...overrides }) as EntityData;

const { canExecute, execute } = makeDeleteAction({ userId: () => ME });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.splitManager = undefined;
});

describe('makeDeleteAction.execute', () => {
  const reminder = entity('reminder', { ownerId: '' });

  it('deletes a reminder without a confirmation step', async () => {
    await execute([reminder]);

    expect(mocks.bulkDeleteMutateAsync).toHaveBeenCalledWith([reminder]);
    expect(mocks.openBulkEditModal).not.toHaveBeenCalled();
  });

  it('reports and removes history only for reminders that succeeded in a partial batch', async () => {
    const deleted = entity('reminder', { id: 'deleted-reminder' });
    const failed = entity('reminder', { id: 'failed-reminder' });
    mocks.bulkDeleteMutateAsync.mockRejectedValueOnce(
      new BulkDeleteFailure([deleted, failed], [true, false])
    );
    mocks.splitManager = {};
    const onDeleted = vi.fn();
    const action = makeDeleteAction({ userId: () => ME, onDeleted });
    await action.execute([deleted, failed]);
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith([deleted]));
    expect(mocks.success).not.toHaveBeenCalled();
    const predicate = mocks.removeHistory.mock.calls[0][1] as (entry: {
      id: string;
    }) => boolean;
    expect(predicate({ id: deleted.id })).toBe(true);
    expect(predicate({ id: failed.id })).toBe(false);
  });

  it('still confirms for everything else', async () => {
    await execute([entity('document')]);

    expect(mocks.openBulkEditModal).toHaveBeenCalledOnce();
  });

  it('notifies after a confirmed deletion succeeds', async () => {
    const onDeleted = vi.fn();
    const doc = entity('document');
    const action = makeDeleteAction({ userId: () => ME, onDeleted });

    await action.execute([doc]);

    expect(onDeleted).not.toHaveBeenCalled();
    const [{ onFinish }] = mocks.openBulkEditModal.mock.calls[0] as unknown as [
      { onFinish: () => void },
    ];
    onFinish();
    expect(onDeleted).toHaveBeenCalledWith([doc]);
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

type DeleteModal = {
  onPartialDelete: (deleted: EntityData[], remaining: EntityData[]) => void;
  onFinish: () => void;
  onCancel?: () => void;
};
const currentDeleteModal = () =>
  mocks.openBulkEditModal.mock.calls.at(-1)![0] as DeleteModal;

function listState(entities: EntityData[]) {
  let focused: string | undefined = entities[0]?.id;
  const selected = new Set(entities.map((entity) => entity.id));
  const rows = entities.map(
    (original, index) =>
      ({
        id: original.id,
        identityKey: original.id,
        original,
        index,
        group: undefined,
        getIsGrouped: () => false,
        getIsLoadMore: () => false,
        isFocused: () => focused === original.id,
        isSelected: () => selected.has(original.id),
      }) as SoupRow
  );
  const focusSet = vi.fn((id: string | undefined) => {
    focused = id;
  });
  const clear = vi.fn(() => selected.clear());
  const peekOffset = vi.fn<EntityActionListState['navigate']['peekOffset']>(
    (direction, options) => {
      const candidates = direction >= 0 ? rows : rows.toReversed();
      const row = candidates.find((row) => !options?.skip?.(row));
      return row ? { row, index: row.index } : undefined;
    }
  );
  const soup: EntityActionListState = {
    focus: {
      id: () => focused,
      index: () => rows.findIndex((row) => row.id === focused),
      set: focusSet,
    },
    items: {
      count: () => rows.length,
      at: (index) => rows[index],
      get: (id) => rows.find((row) => row.id === id),
    },
    navigate: { peekOffset },
    selection: { clear },
    collapseEntity: { shouldCollapse: () => false, callback: () => undefined },
  };
  return { soup, selected, focusSet, clear, rows };
}

function removedByCleanup(call: number, id: string) {
  const predicate = mocks.removeHistory.mock.calls[call][1] as (entry: {
    id: string;
  }) => boolean;
  return predicate({ id });
}

describe('confirmed partial deletion cleanup', () => {
  const deleted = entity('document', { id: 'deleted' });
  const failed = entity('document', { id: 'failed' });
  const survivor = entity('document', { id: 'survivor' });

  it('notifies direct callers immediately and does not report the same success again after retry', async () => {
    mocks.splitManager = {};
    const onDeleted = vi.fn();
    const action = makeDeleteAction({ userId: () => ME, onDeleted });
    await action.execute([deleted, failed]);
    const modal = currentDeleteModal();
    modal.onPartialDelete([deleted], [failed]);
    expect(onDeleted).toHaveBeenCalledWith([deleted]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(removedByCleanup(0, deleted.id)).toBe(true);
    expect(removedByCleanup(0, failed.id)).toBe(false);
    modal.onFinish();
    expect(onDeleted).toHaveBeenNthCalledWith(2, [failed]);
    expect(onDeleted).toHaveBeenCalledTimes(2);
    expect(removedByCleanup(1, deleted.id)).toBe(false);
    expect(removedByCleanup(1, failed.id)).toBe(true);
  });

  it('cleans successful history/selection before Cancel and restores focus to a failed item', async () => {
    mocks.splitManager = {};
    const { soup, selected, focusSet } = listState([deleted, failed, survivor]);
    const action = makeDeleteAction({ userId: () => ME });
    await action.executeWithSoup([deleted, failed], soup);
    const modal = currentDeleteModal();
    modal.onPartialDelete([deleted], [failed]);
    expect(selected.size).toBe(0);
    expect(removedByCleanup(0, deleted.id)).toBe(true);
    expect(removedByCleanup(0, failed.id)).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    modal.onCancel?.();
    expect(focusSet).toHaveBeenLastCalledWith(failed.id);
    expect(mocks.restoreFocus).toHaveBeenLastCalledWith(failed.id);
    expect(mocks.removeHistory).toHaveBeenCalledOnce();
  });

  it('avoids already deleted focus targets after multiple partial attempts and a final success', async () => {
    mocks.splitManager = {};
    const second = entity('document', { id: 'second-deleted' });
    const { soup, focusSet } = listState([deleted, second, failed, survivor]);
    const action = makeDeleteAction({ userId: () => ME });
    await action.executeWithSoup([deleted, second, failed], soup);
    const modal = currentDeleteModal();
    modal.onPartialDelete([deleted], [second, failed]);
    modal.onPartialDelete([second], [failed]);
    modal.onFinish();
    expect(mocks.removeHistory).toHaveBeenCalledTimes(3);
    expect(removedByCleanup(2, deleted.id)).toBe(false);
    expect(removedByCleanup(2, second.id)).toBe(false);
    expect(removedByCleanup(2, failed.id)).toBe(true);
    expect(focusSet).toHaveBeenLastCalledWith(survivor.id);
  });

  it('uses a live surviving neighbour if the failed row disappeared before Cancel', async () => {
    const { soup, rows, focusSet } = listState([deleted, failed, survivor]);
    const action = makeDeleteAction({ userId: () => ME });
    await action.executeWithSoup([deleted, failed], soup);
    const modal = currentDeleteModal();
    modal.onPartialDelete([deleted], [failed]);
    rows.splice(
      rows.findIndex((row) => row.id === failed.id),
      1
    );
    modal.onCancel?.();
    expect(focusSet).toHaveBeenLastCalledWith(survivor.id);
    expect(mocks.restoreFocus).toHaveBeenLastCalledWith(survivor.id);
  });

  it('does not run the deferred email deletion lane after a partial failure and Cancel', async () => {
    const email = entity('email', { id: 'email' });
    const { soup } = listState([deleted, failed, email]);
    const action = makeDeleteAction({ userId: () => ME });
    await action.executeWithSoup([deleted, failed, email], soup);
    const modal = currentDeleteModal();
    modal.onPartialDelete([deleted], [failed]);
    modal.onCancel?.();
    expect(mocks.trashEmails).not.toHaveBeenCalled();
  });
});

describe('makeDeleteAction.canExecute', () => {
  it('only offers session deletion to its owner', () => {
    expect(canExecute(entity('agent_session'))).toBe(true);
    expect(
      canExecute(
        entity('agent_session', { ownerId: 'macro|other@example.com' })
      )
    ).toBe(false);
  });
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
