import type { ResultError } from '@core/util/result';
import type {
  ApiBulkThreadAction,
  ApiBulkThreadTarget,
  ApplyBulkThreadActionResponse,
  ListBulkThreadTargetsResponse,
} from '@service-email/generated/schemas';
import type { Result } from 'neverthrow';
import { createMemo, createSignal } from 'solid-js';
import type { EmailBulkQuery } from '../queries/bulk-query';
import type { EmailBulkTargetsRequest } from '../queries/bulk-threads';
import type { EmailBulkIntent, EmailBulkOverlay } from './bulk-overlay';

/** The server accepts at most this many threads per action request. */
export const EMAIL_BULK_BATCH_SIZE = 100;

/** "Select all below" a row, or everything the view lists. */
export type EmailBulkScope = 'below' | 'view';

export type EmailBulkActionKind = 'done' | 'read';

type SelectionBasis = {
  scope: EmailBulkScope;
  anchorId?: string;
  /** The view query the selection was resolved from. */
  query: EmailBulkQuery;
};

export type EmailBulkSelectionState =
  | { status: 'idle' }
  | (SelectionBasis & { status: 'resolving'; count: number })
  | (SelectionBasis & { status: 'ready'; targets: ApiBulkThreadTarget[] })
  | (SelectionBasis & { status: 'failed'; message: string });

const IDLE: EmailBulkSelectionState = { status: 'idle' };

const sameQuery = (left: EmailBulkQuery, right: EmailBulkQuery | undefined) =>
  right !== undefined && JSON.stringify(left) === JSON.stringify(right);

export type EmailBulkProgress = {
  label: string;
  completed: number;
  total: number;
};

type Fallible<T> = Promise<Result<T, ResultError[]>>;

/** What a bulk selection needs from the network and the app shell. */
export type EmailBulkCapabilities = {
  listTargets: (
    request: EmailBulkTargetsRequest
  ) => Fallible<ListBulkThreadTargetsResponse>;
  applyAction: (
    threadIds: string[],
    action: ApiBulkThreadAction
  ) => Fallible<ApplyBulkThreadActionResponse>;
  markNotificationsDone: (threadIds: string[]) => Fallible<string[]>;
  restoreNotifications: (notificationIds: string[]) => Fallible<void>;
  refreshLists: (threadIds: string[]) => Promise<void>;
  confirm: (prompt: {
    title: string;
    body: string;
    confirmLabel: string;
  }) => Promise<boolean>;
  /** Registers a completed action with the app's undo stack and toast. */
  announce: (announcement: {
    message: string;
    partial: boolean;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
  }) => void;
  failure: (message: string) => void;
};

type BulkActionDefinition = {
  forward: ApiBulkThreadAction;
  inverse: ApiBulkThreadAction;
  /** Threads the action would change; the rest are already in that state. */
  changes: (target: ApiBulkThreadTarget) => boolean;
  intent: Pick<EmailBulkIntent, 'done' | 'read'>;
  undoIntent: Pick<EmailBulkIntent, 'done' | 'read'>;
  verb: string;
  progress: string;
  undoProgress: string;
};

const BULK_ACTIONS: Record<EmailBulkActionKind, BulkActionDefinition> = {
  done: {
    forward: 'archive',
    inverse: 'unarchive',
    changes: (target) => !target.done,
    intent: { done: true },
    undoIntent: { done: false },
    verb: 'done',
    progress: 'Marking done',
    undoProgress: 'Restoring to inbox',
  },
  read: {
    forward: 'mark_read',
    inverse: 'mark_unread',
    changes: (target) => !target.read,
    intent: { read: true },
    undoIntent: { read: false },
    verb: 'read',
    progress: 'Marking read',
    undoProgress: 'Marking unread',
  },
};

/** One bulk action applies at a time: they share the progress bar. */
const BUSY_MESSAGE = 'Wait for the current bulk action to finish.';

export const formatConversationCount = (count: number) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'conversation' : 'conversations'}`;

type BatchOutcome = { succeeded: string[]; failed: string[] };

export type CreateEmailBulkSelectionOptions = {
  capabilities: EmailBulkCapabilities;
  overlay: EmailBulkOverlay;
  /** The view's server query; undefined where a bulk selection can't reach every row. */
  query: () => EmailBulkQuery | undefined;
  /** The view's name in prompts, e.g. "Signal". */
  viewLabel: () => string;
};

/**
 * A selection the server resolves from the view's query, so it reaches rows
 * the list never loaded, and the batched, undoable actions it runs.
 */
export function createEmailBulkSelection(
  options: CreateEmailBulkSelectionOptions
) {
  const { capabilities, overlay } = options;
  const [selection, setSelection] = createSignal<EmailBulkSelectionState>(IDLE);
  const [progress, setProgress] = createSignal<EmailBulkProgress>();
  // Each selection gets a generation; a page for an older one is dropped.
  let generation = 0;

  const query = createMemo(() => options.query());
  // A selection belongs to the query it was resolved from: changing the tab,
  // inbox, filters or search leaves nothing selected.
  const state = createMemo((): EmailBulkSelectionState => {
    const current = selection();
    return current.status === 'idle' || sameQuery(current.query, query())
      ? current
      : IDLE;
  });

  const clear = () => {
    generation++;
    setSelection(IDLE);
  };

  async function resolve(scope: EmailBulkScope, anchorId?: string) {
    const viewQuery = query();
    if (!viewQuery) return;
    const current = ++generation;
    const basis: SelectionBasis = { scope, anchorId, query: viewQuery };
    setSelection({ ...basis, status: 'resolving', count: 0 });

    const targets: ApiBulkThreadTarget[] = [];
    let cursor: EmailBulkTargetsRequest['cursor'];
    do {
      const page = await capabilities.listTargets({
        query: viewQuery,
        fromThreadId: cursor ? undefined : anchorId,
        cursor,
      });
      if (current !== generation || !sameQuery(viewQuery, query())) return;
      if (page.isErr()) {
        const gone = page.error.some((error) => error.code === 'NOT_FOUND');
        setSelection({
          ...basis,
          status: 'failed',
          message: gone
            ? `That email is no longer in ${options.viewLabel()}.`
            : 'Couldn’t select those emails. Try again.',
        });
        return;
      }
      targets.push(...page.value.threads);
      cursor = page.value.nextCursor ?? undefined;
      if (cursor) {
        setSelection({ ...basis, status: 'resolving', count: targets.length });
      }
    } while (cursor);
    setSelection({ ...basis, status: 'ready', targets });
  }

  async function applyInBatches(
    threadIds: string[],
    action: ApiBulkThreadAction,
    label: string,
    afterBatch?: (succeeded: string[]) => Promise<void>
  ): Promise<BatchOutcome> {
    const outcome: BatchOutcome = { succeeded: [], failed: [] };
    setProgress({ label, completed: 0, total: threadIds.length });
    for (
      let start = 0;
      start < threadIds.length;
      start += EMAIL_BULK_BATCH_SIZE
    ) {
      const batch = threadIds.slice(start, start + EMAIL_BULK_BATCH_SIZE);
      const result = await capabilities.applyAction(batch, action);
      if (result.isOk()) {
        outcome.succeeded.push(...result.value.succeededIds);
        outcome.failed.push(...result.value.failedIds);
        if (result.value.succeededIds.length > 0)
          await afterBatch?.(result.value.succeededIds);
      } else {
        // The request may still have committed; repeating it is harmless.
        outcome.failed.push(...batch);
      }
      setProgress({
        label,
        completed: Math.min(start + batch.length, threadIds.length),
        total: threadIds.length,
      });
    }
    setProgress(undefined);
    return outcome;
  }

  async function run(kind: EmailBulkActionKind) {
    const ready = state();
    if (ready.status !== 'ready') return;
    if (progress()) {
      capabilities.failure(BUSY_MESSAGE);
      return;
    }
    const action = BULK_ACTIONS[kind];
    const targets = ready.targets.filter(action.changes);
    if (targets.length === 0) {
      capabilities.failure(`Those conversations are already ${action.verb}.`);
      clear();
      return;
    }

    const count = formatConversationCount(targets.length);
    const where =
      ready.scope === 'below'
        ? `the selected email and every older one in ${options.viewLabel()}`
        : `every conversation in ${options.viewLabel()}`;
    const confirmed = await capabilities.confirm({
      title: `Mark ${count} ${action.verb}?`,
      body: `This marks ${where} as ${action.verb}. You can undo it afterwards.`,
      confirmLabel: `Mark ${action.verb}`,
    });
    if (!confirmed || state() !== ready) return;
    clear();

    let changed = targets;
    let notificationIds: string[] = [];
    const forward = async (pending: ApiBulkThreadTarget[]) => {
      overlay.set(pending, action.intent);
      const outcome = await applyInBatches(
        pending.map((target) => target.id),
        action.forward,
        action.progress,
        kind === 'done'
          ? async (succeeded) => {
              const acknowledged =
                await capabilities.markNotificationsDone(succeeded);
              if (acknowledged.isOk())
                notificationIds = [...notificationIds, ...acknowledged.value];
            }
          : undefined
      );
      overlay.remove(outcome.failed);
      await capabilities.refreshLists(outcome.succeeded);
      const succeeded = new Set(outcome.succeeded);
      changed = pending.filter((target) => succeeded.has(target.id));
      return outcome;
    };

    const outcome = await forward(targets);
    if (outcome.succeeded.length === 0) {
      capabilities.failure(`Couldn’t mark ${count} ${action.verb}.`);
      return;
    }

    const partial = outcome.failed.length > 0;
    capabilities.announce({
      message: partial
        ? `Marked ${outcome.succeeded.length.toLocaleString('en-US')} of ${count} ${action.verb}. Some couldn’t be changed.`
        : `Marked ${count} ${action.verb}`,
      partial,
      undo: async () => {
        if (progress()) throw new Error(BUSY_MESSAGE);
        const restoring = changed;
        overlay.set(restoring, action.undoIntent);
        const reverted = await applyInBatches(
          restoring.map((target) => target.id),
          action.inverse,
          action.undoProgress
        );
        overlay.remove(reverted.failed);
        if (notificationIds.length > 0) {
          await capabilities.restoreNotifications(notificationIds);
          notificationIds = [];
        }
        await capabilities.refreshLists(reverted.succeeded);
        if (reverted.failed.length > 0) {
          throw new Error(
            `Couldn’t undo ${formatConversationCount(reverted.failed.length)}`
          );
        }
      },
      redo: async () => {
        if (progress()) throw new Error(BUSY_MESSAGE);
        const redone = await forward(changed);
        if (redone.failed.length > 0) {
          throw new Error(
            `Couldn’t redo ${formatConversationCount(redone.failed.length)}`
          );
        }
      },
    });
  }

  return {
    state,
    progress,
    isActive: () => state().status !== 'idle',
    canSelect: () => query() !== undefined,
    selectBelow: (anchorId: string) => resolve('below', anchorId),
    selectView: () => resolve('view'),
    retry: async () => {
      const failed = state();
      if (failed.status === 'failed')
        await resolve(failed.scope, failed.anchorId);
    },
    clear,
    run,
  };
}

export type EmailBulkSelection = ReturnType<typeof createEmailBulkSelection>;
