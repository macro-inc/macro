import type { UnifiedNotification } from '@notifications/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  InboxRequests,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import type { InboxRowAction } from '../core/inbox-row';
import { createRowActions, decisionRequest, rowButtons } from './row-actions';

const telemetry = vi.hoisted(() => {
  const spans: { name: string; attributes: Record<string, unknown> }[] = [];
  return {
    spans,
    span: (name: string, work: (span: unknown) => Promise<unknown>) => {
      const recorded = { name, attributes: {} as Record<string, unknown> };
      spans.push(recorded);
      return work({
        setAttr: (key: string, value: unknown) => {
          recorded.attributes[key] = value;
        },
        error: () => {},
      });
    },
  };
});

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { span: telemetry.span },
}));

afterEach(() => {
  telemetry.spans.length = 0;
});

const accessRequest = {
  id: 'n-1',
  entity_type: 'document',
  entity_id: 'doc-a',
  notification_metadata: {
    tag: 'entity_access_requested',
    content: {
      requestId: 'req-1',
      revision: 3,
      accessLevel: 'edit',
      entityName: 'Plan',
    },
  },
} as unknown as UnifiedNotification;

const approve: InboxRowAction = { kind: 'approve', targetId: 'req-1' };
const deny: InboxRowAction = { kind: 'deny', targetId: 'req-1' };

const row = (
  actions: InboxRowAction[],
  notifications: UnifiedNotification[] = [accessRequest]
): NotificationInboxRow => ({
  id: 'document:doc-a#access_requested:req-1',
  type: 'access_requested',
  revision: 'rev',
  latestAt: 1,
  actions,
  unseen: true,
  count: notifications.length,
  content: {
    entity: { type: 'document', id: 'doc-a', name: 'Plan' } as never,
    notifications,
  },
});

function setup(requests: Partial<InboxRequests> = {}) {
  const complete = vi.fn(async () => {});
  const open = vi.fn();
  const review = vi.fn();
  const notices = { succeeded: vi.fn(), failed: vi.fn() };
  const rowActions = createRowActions({
    requests: {
      resolveAccessRequest: vi.fn(async () => {}),
      answerJoinRequest: vi.fn(async () => {}),
      ...requests,
    },
    open,
    review,
    complete,
    notices,
  });
  return { rowActions, complete, open, review, notices };
}

describe('rowButtons', () => {
  it('offers the server’s actions in order', () => {
    const review: InboxRowAction = {
      kind: 'review',
      url: 'https://github.com/macro-inc/macro/pull/1',
    };
    expect(rowButtons(row([approve, deny]))).toEqual([approve, deny]);
    expect(rowButtons(row([{ kind: 'answer' }]))).toEqual([{ kind: 'answer' }]);
    expect(rowButtons(row([review]))).toEqual([review]);
  });

  it('skips a decision on a request the row doesn’t show', () => {
    const other: InboxRowAction = { kind: 'approve', targetId: 'req-2' };
    const accept: InboxRowAction = { kind: 'accept', targetId: 'req-1' };
    expect(rowButtons(row([other, { kind: 'open' }]))).toEqual([
      { kind: 'open' },
    ]);
    expect(rowButtons(row([accept]))).toEqual([]);
  });
});

describe('decisionRequest', () => {
  it('reads the request from the notification that carries it', () => {
    expect(decisionRequest(row([approve]), { ...approve })).toEqual({
      kind: 'access_request',
      entityType: 'document',
      entityId: 'doc-a',
      requestId: 'req-1',
      revision: 3,
      level: 'edit',
    });
  });
});

describe('createRowActions', () => {
  it('approves at the requested level, then completes the row', async () => {
    const resolveAccessRequest = vi.fn(async () => {});
    const { rowActions, complete, notices } = setup({ resolveAccessRequest });
    const target = row([approve, deny]);

    await rowActions.run(target, approve);

    expect(resolveAccessRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', level: 'edit' }),
      true
    );
    expect(notices.succeeded).toHaveBeenCalledWith('approve');
    expect(complete).toHaveBeenCalledWith(target);
    expect(rowActions.pending(target.id)).toBeUndefined();
  });

  it('traces the decision by its request, with completing the row as a step', async () => {
    const { rowActions } = setup();

    await rowActions.run(row([approve, deny]), approve);

    expect(telemetry.spans.map((span) => span.name)).toEqual([
      'notifications_inbox.row_answer',
      'notifications_inbox.row_done',
    ]);
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'inbox.answer': 'approve',
      'access_request.id': 'req-1',
      'entity.type': 'document',
      'entity.id': 'doc-a',
      'inbox.outcome': 'succeeded',
    });
  });

  it('leaves the row when the decision fails', async () => {
    const { rowActions, complete, notices } = setup({
      resolveAccessRequest: vi.fn(async () => {
        throw new Error('stale revision');
      }),
    });
    const target = row([approve, deny]);

    await rowActions.run(target, deny);

    expect(notices.failed).toHaveBeenCalledWith('deny');
    expect(complete).not.toHaveBeenCalled();
    expect(rowActions.pending(target.id)).toBeUndefined();
  });

  it('runs one decision per row at a time', async () => {
    let finish!: () => void;
    const resolveAccessRequest = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const { rowActions } = setup({ resolveAccessRequest });
    const target = row([approve, deny]);

    const first = rowActions.run(target, approve);
    expect(rowActions.pending(target.id)).toBe('approve');
    await rowActions.run(target, deny);
    finish();
    await first;

    expect(resolveAccessRequest).toHaveBeenCalledOnce();
  });

  it('opens the row for Open and Answer, and the pull request for Review', async () => {
    const { rowActions, open, review, complete } = setup();
    const url = 'https://github.com/macro-inc/macro/pull/1';
    const target = row([{ kind: 'answer' }]);

    await rowActions.run(target, { kind: 'answer' });
    await rowActions.run(target, { kind: 'open' });
    await rowActions.run(target, { kind: 'review', url });

    expect(open).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledWith(target, url);
    expect(complete).not.toHaveBeenCalled();
    expect(telemetry.spans).toEqual([]);
  });
});
