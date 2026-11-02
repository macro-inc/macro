import type { EntityData } from '@entity';
import { err, ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityActionListState } from './entity-action-context';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  failure: vi.fn(),
  readThreadDrafts: vi.fn(),
  queueActive: vi.fn(() => true),
  deleteQueued: vi.fn(),
  deleteRest: vi.fn(),
  markSaved: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
// The real barrel reaches the query clients, which open websockets under jsdom.
vi.mock('@entity', () => ({
  isEmailEntity: (entity: EntityData) => entity.type === 'email',
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    error: vi.fn(),
    span: (_name: string, run: (span: object) => unknown) =>
      run({ setAttr: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock('@queries/email/thread-drafts', () => ({
  readThreadDrafts: mocks.readThreadDrafts,
}));
vi.mock('@queries/email/draft-queue', () => ({
  draftQueueActive: mocks.queueActive,
  deleteEmailDraftQueued: mocks.deleteQueued,
}));
vi.mock('@queries/email/draft', () => ({
  useDeleteDraftMutation: () => ({ mutateAsync: mocks.deleteRest }),
}));
vi.mock('@queries/email/draft-cache', () => ({
  markThreadDraftSaved: mocks.markSaved,
}));
vi.mock('@queries/email/draft-lifecycle-events', () => ({
  publishDraftLifecycleChange: mocks.publish,
}));
vi.mock('@queries/email/link', () => ({
  useNonPrimaryEmailLinkIdHeader: () => (linkId?: string | null) =>
    linkId === 'primary' ? undefined : (linkId ?? undefined),
}));

import { makeDiscardDraftAction } from './make-discard-draft-action';

const email = (overrides: Record<string, unknown> = {}) =>
  ({
    type: 'email',
    id: 'thread-1',
    name: 'Partnerships',
    isDraft: true,
    ...overrides,
  }) as unknown as EntityData;

const draft = {
  draftId: 'draft-1',
  draftGeneration: 3,
  inboxId: 'primary',
};

const listWithHold = (hold: (ids: readonly string[]) => void) =>
  ({ positions: { hold } }) as unknown as EntityActionListState;

const createAction = () =>
  createRoot((dispose) => ({ action: makeDiscardDraftAction(), dispose }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueActive.mockReturnValue(true);
  mocks.readThreadDrafts.mockResolvedValue(ok([draft]));
  mocks.deleteQueued.mockResolvedValue({ kind: 'committed' });
  mocks.deleteRest.mockResolvedValue(undefined);
});

describe('makeDiscardDraftAction', () => {
  it('only applies to email threads with a draft', () => {
    const { action, dispose } = createAction();

    expect(action.canExecute(email())).toBe(true);
    expect(action.canExecute(email({ isDraft: false }))).toBe(false);
    expect(action.canExecute(email({ type: 'document' }))).toBe(false);
    dispose();
  });

  it('holds the row in place before deleting the draft through the queue', async () => {
    const { action, dispose } = createAction();
    const order: string[] = [];
    const hold = vi.fn(() => order.push('hold'));
    mocks.readThreadDrafts.mockImplementation(async () => {
      order.push('read');
      return ok([draft]);
    });

    await action.executeWithSoup([email()], listWithHold(hold));

    expect(hold).toHaveBeenCalledWith(['thread-1']);
    expect(order).toEqual(['hold', 'read']);
    expect(mocks.deleteQueued).toHaveBeenCalledWith({
      draftId: 'draft-1',
      draftGeneration: 3,
      threadId: 'thread-1',
    });
    expect(mocks.publish).toHaveBeenCalledWith('draft-1', 'primary');
    expect(mocks.success).toHaveBeenCalledOnce();
    dispose();
  });

  it('deletes through REST when the draft queue is off', async () => {
    mocks.queueActive.mockReturnValue(false);
    mocks.readThreadDrafts.mockResolvedValue(
      ok([{ ...draft, inboxId: 'work-inbox' }])
    );
    const { action, dispose } = createAction();

    await action.execute([email()]);

    expect(mocks.deleteRest).toHaveBeenCalledWith({
      draftId: 'draft-1',
      draftGeneration: 3,
      threadId: 'thread-1',
      linkId: 'work-inbox',
    });
    expect(mocks.markSaved).toHaveBeenCalledWith('thread-1');
    expect(mocks.deleteQueued).not.toHaveBeenCalled();
    dispose();
  });

  it('reports a failed delete once', async () => {
    mocks.deleteQueued.mockRejectedValue(new Error('offline'));
    const { action, dispose } = createAction();

    await action.execute([email()]);

    expect(mocks.failure).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
    dispose();
  });

  it('reports a thread it cannot read', async () => {
    mocks.readThreadDrafts.mockResolvedValue(
      err({ kind: 'thread-unavailable', codes: ['NOT_FOUND'] })
    );
    const { action, dispose } = createAction();

    await action.execute([email()]);

    expect(mocks.deleteQueued).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledOnce();
    dispose();
  });

  it('leaves rejection notices to the draft queue', async () => {
    mocks.deleteQueued.mockResolvedValue({
      kind: 'rejected',
      code: 'DRAFT_ALREADY_SENT',
    });
    const { action, dispose } = createAction();

    await action.execute([email()]);

    expect(mocks.failure).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    dispose();
  });
});
