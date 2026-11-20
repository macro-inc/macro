import { createMemo, createRoot, getOwner, type Owner } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RoutineListSource,
  RoutineRowOperations,
} from './context/routine-sources';
import type { RoutineSnapshot } from './core/routine';
import type { RoutineRow } from './core/types';
import { useRoutineRowMenuActions } from './routine-row-menu-actions';

const mocks = vi.hoisted(() => ({
  openDelete: vi.fn(),
  /** Answers the routine's own read of what its runs created. */
  answerCount: (_count: number | undefined): void => {},
}));

vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openOwnedBulkEditModal: mocks.openDelete,
}));
vi.mock('@app/features/next-soup/actions', () => ({
  makeCopyLinkAction: () => ({ executeByBlock: vi.fn() }),
  makeCopyEntityIdAction: () => ({ executeById: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => {} }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), alert: vi.fn() },
}));
vi.mock('./routine-template', () => ({ openShareRoutineDialog: vi.fn() }));
vi.mock('./queries/routine-sources', () => ({
  createRoutineRowOperations: (): RoutineRowOperations => ({
    entity: (id) => ({
      id,
      type: 'routine',
      name: 'Inbox triage',
      ownerId: 'me',
      status: { kind: 'unscheduled' },
    }),
    run: vi.fn(),
    runPending: () => false,
    duplicate: vi.fn(),
    keepAsOwn: vi.fn(),
    createdCount: () =>
      new Promise((resolve) => {
        mocks.answerCount = resolve;
      }),
  }),
}));

const triage: RoutineRow = {
  id: 'triage',
  name: 'Inbox triage',
  createdAt: '',
  when: 'When an email arrives',
  whenKind: 'email',
  does: 'Sort my inbox',
  group: 'activity',
  status: 'Active',
  enabled: true,
  editable: true,
  children: [],
  pausedByParent: false,
};

/** The one sub-routine of triage the list holds: an active one. */
const listed: RoutineSnapshot = {
  id: 'follow-up',
  name: 'Follow up',
  ownerId: 'me',
  createdAt: '',
  enabled: true,
  revision: 1,
  configurationKey: 'follow-up',
  parent: { id: 'triage', createdByRunId: 'run', pausedByParent: false },
};

const source: RoutineListSource = {
  routines: () => [],
  subRoutines: () => [listed],
  loading: () => false,
  error: () => false,
  refresh: async () => {},
  setEnabled: vi.fn(),
  pendingId: () => undefined,
};

type DeleteSession = { note?: string };

function deleteFromList() {
  let owner: Owner | null = null;
  const dispose = createRoot((dispose) => {
    owner = getOwner();
    useRoutineRowMenuActions(source, { open: vi.fn() }).onDelete(triage);
    return dispose;
  });
  return { owner, dispose };
}

/** The note as the open dialog shows it: read in a tracked scope. */
function shownNote(session: DeleteSession) {
  return createRoot((dispose) => ({
    note: createMemo(() => session.note),
    dispose,
  }));
}

const opened = () => {
  expect(mocks.openDelete).toHaveBeenCalledOnce();
  const [session, owner] = mocks.openDelete.mock.calls[0] as [
    DeleteSession,
    Owner | null,
  ];
  return { session, owner };
};

afterEach(() => mocks.openDelete.mockReset());

describe('routine row Delete', () => {
  it('asks at once under the list, then counts what the routine created', async () => {
    const list = deleteFromList();
    // Before the routine's own read answers: the list's count.
    const { session, owner } = opened();
    // Under the list's owner, so it stacks on a sheet the list is in.
    expect(owner).toBe(list.owner);
    const shown = shownNote(session);
    expect(shown.note()).toBe('The 1 routine it created will be deleted too.');
    // Finished one-time routines count too, though the list doesn't hold them.
    // The dialog is already open, so its note follows.
    mocks.answerCount(3);
    await vi.waitFor(() =>
      expect(shown.note()).toBe(
        'The 3 routines it created will be deleted too.'
      )
    );
    shown.dispose();
    list.dispose();
  });

  it('keeps the list’s count when the routine’s own can’t be read', async () => {
    const list = deleteFromList();
    const { session } = opened();
    mocks.answerCount(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.note).toBe('The 1 routine it created will be deleted too.');
    list.dispose();
  });
});
