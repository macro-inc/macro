import { BulkDeleteFailure } from '@app/features/entity/queries/bulk-delete-result';
import type { EntityData } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

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

vi.mock('@app/features/next-soup/filters/configs/', () => ({
  SOUP_FILTERS: [],
}));
vi.mock('@app/features/next-soup/soup-view/sort-options', () => ({
  SORT_CONFIGS: { updated_at: { id: 'updated_at', fn: () => 0 } },
}));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('./make-mark-done-action', () => ({
  canExecuteMarkDoneOnView: () => true,
}));

import { createListController } from '@app/components/list/create-list-controller';
import { createSoupState, type SoupRow } from '../create-soup-state';
import {
  type EntityActionListState,
  toEntityActionListState,
} from './entity-action-context';
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

function liveListState(
  adapter: 'legacy' | 'controller',
  initial: EntityData[],
  focusId: string
) {
  return createRoot((dispose) => {
    onTestFinished(dispose);
    if (adapter === 'legacy') {
      const soup = createSoupState({ initialData: initial });
      soup.focus.set(focusId);
      return {
        soup,
        setItems: (items: EntityData[]) =>
          soup.setRows(
            items.map((original, index) =>
              soup.buildRow({ id: original.id, original, index })
            )
          ),
      };
    }
    const [items, setItems] = createSignal(initial);
    const controller = createListController({
      items,
      getKey: (item: EntityData) => `row:${item.id}`,
    });
    const soup = toEntityActionListState({
      controller,
      getEntity: (item) => item,
    });
    soup.focus.set(focusId);
    return {
      soup,
      setItems: (next: EntityData[]) => {
        setItems(next);
      },
    };
  });
}

const focusCases = [
  {
    name: 'preserves the originally captured next neighbour',
    initial: ['top', 'before', 'deleted', 'neighbour', 'retry', 'tail'],
    final: ['top', 'before', 'neighbour', 'tail'],
    expected: 'neighbour',
  },
  {
    name: 'skips the rest of a contiguous deleted block',
    initial: ['top', 'before', 'deleted', 'retry', 'neighbour', 'tail'],
    final: ['top', 'before', 'neighbour', 'tail'],
    expected: 'neighbour',
  },
  {
    name: 'falls back to the preceding neighbour at the end of the list',
    initial: ['top', 'before', 'deleted', 'retry'],
    final: ['top', 'before'],
    expected: 'before',
  },
  {
    name: 'keeps the neighbour by identity when rows are inserted or reordered',
    initial: ['top', 'before', 'deleted', 'neighbour', 'retry', 'tail'],
    final: ['inserted', 'top', 'before', 'tail', 'neighbour'],
    expected: 'neighbour',
  },
  {
    name: 'uses the preceding anchor when the next neighbour also disappears',
    initial: ['top', 'before', 'deleted', 'retry', 'neighbour', 'tail'],
    final: ['top', 'before', 'tail'],
    expected: 'before',
  },
  {
    name: 'uses a bounded original position when both anchors disappear',
    initial: ['top', 'before', 'deleted', 'retry', 'neighbour', 'tail'],
    final: ['new-top', 'new-nearby'],
    expected: 'new-nearby',
  },
  {
    name: 'clears focus when no rows remain',
    initial: ['deleted', 'retry'],
    final: [],
    expected: undefined,
  },
];

describe.each(['legacy', 'controller'] as const)(
  'partial delete focus on the real %s list',
  (adapter) => {
    it.each(focusCases)('$name', async ({ initial, final, expected }) => {
      const items = new Map(
        [...initial, ...final].map((id) => [id, entity('document', { id })])
      );
      const { soup, setItems } = liveListState(
        adapter,
        initial.map((id) => items.get(id)!),
        'deleted'
      );
      const deleted = items.get('deleted')!;
      const retry = items.get('retry')!;
      const action = makeDeleteAction({ userId: () => ME });
      await action.executeWithSoup([deleted, retry], soup);
      const modal = currentDeleteModal();
      // Real list updates invalidate the focused row's index. A mock that only
      // skips deleted ids, without losing focus, misses the jump-to-top bug.
      setItems(
        initial.filter((id) => id !== deleted.id).map((id) => items.get(id)!)
      );
      modal.onPartialDelete([deleted], [retry]);
      setItems(final.map((id) => items.get(id)!));
      expect(soup.focus.index()).toBe(-1);
      modal.onFinish();
      const focusId = soup.focus.id();
      expect(
        focusId === undefined ? undefined : soup.items.get(focusId)?.original.id
      ).toBe(expected);
      expect(mocks.restoreFocus).toHaveBeenLastCalledWith(focusId);
    });
  }
);

it('skips grouped headers and load-more rows when anchoring partial-delete focus', async () => {
  const soup = createRoot((dispose) => {
    onTestFinished(dispose);
    return createSoupState();
  });
  const top = entity('document', { id: 'top' });
  const deleted = entity('document', { id: 'deleted' });
  const retry = entity('document', { id: 'retry' });
  const neighbour = entity('document', { id: 'neighbour' });
  const group = {
    key: 'group',
    label: 'Group',
    value: 'group',
    count: 1,
    isExpanded: () => true,
    toggle: () => {},
  };
  const structural = [
    soup.buildRow({
      id: 'header',
      index: 3,
      original: neighbour,
      group,
      isGrouped: true,
    }),
    soup.buildRow({
      id: 'more',
      index: 4,
      original: neighbour,
      group,
      isLoadMore: true,
    }),
  ];
  soup.setRows([
    ...[top, deleted, retry].map((original, index) =>
      soup.buildRow({ id: original.id, original, index })
    ),
    ...structural,
    soup.buildRow({ id: neighbour.id, original: neighbour, index: 5, group }),
  ]);
  soup.focus.set(deleted.id);
  await makeDeleteAction({ userId: () => ME }).executeWithSoup(
    [deleted, retry],
    soup
  );
  const modal = currentDeleteModal();
  modal.onPartialDelete([deleted], [retry]);
  soup.setRows([
    soup.buildRow({ id: top.id, original: top, index: 0 }),
    ...structural.map((row, index) => ({ ...row, index: index + 1 })),
    soup.buildRow({ id: neighbour.id, original: neighbour, index: 3, group }),
  ]);
  expect(soup.focus.index()).toBe(-1);
  modal.onFinish();
  expect(soup.focus.id()).toBe(neighbour.id);
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
