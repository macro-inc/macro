import type { LeaveGuardContext } from '@app/lib/split-router/router/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createUnsavedChangesGuard } from './create-unsaved-changes-guard';

type LeaveRequest = {
  identity: unknown;
  scope: unknown;
  controller: AbortController;
  discard: boolean;
  saving: boolean;
  saved: boolean;
};

/** Adds commit-aware navigation and window protection to the shared leave dialog. */
export function createDraftLeave(options: {
  identity: Accessor<unknown>;
  scope: Accessor<unknown>;
  dirty: Accessor<boolean>;
  busy: Accessor<boolean>;
  save: () => Promise<void>;
  discard: () => void;
  saveError: string;
  /** A settings-only route update keeps editing the same draft. */
  staysInDraft?: (context: LeaveGuardContext) => boolean;
}) {
  let pending: LeaveRequest | undefined;
  const isCurrent = (request: LeaveRequest) =>
    !request.controller.signal.aborted &&
    request.scope === options.scope() &&
    (request.identity === options.identity() ||
      (request.saved && options.identity() === undefined));
  const guard = createUnsavedChangesGuard({
    dirty: options.dirty,
    busy: options.busy,
    saveError: options.saveError,
    discard: () => {
      if (pending) pending.discard = true;
    },
    save: async () => {
      const request = pending;
      if (!request || !isCurrent(request)) return;
      request.saving = true;
      try {
        await options.save();
        request.saved = !options.dirty();
      } finally {
        request.saving = false;
      }
    },
  });
  // Account/draft transitions are external lifetime events. A save can retire
  // its own draft, but no later draft or account can inherit the open prompt.
  createEffect(
    on(
      () => [options.identity(), options.scope()] as const,
      ([identity, scope]) => {
        const request = pending;
        if (!request) return;
        const retiringDuringSave = request.saving && identity === undefined;
        if (
          scope !== request.scope ||
          (identity !== request.identity && !retiringDuringSave)
        ) {
          request.controller.abort();
          pending = undefined;
        }
      }
    )
  );
  const decide = (context?: LeaveGuardContext): boolean | Promise<boolean> => {
    if (context && options.staysInDraft?.(context)) return true;
    // A held click must not queue a second action behind one confirmation.
    if (pending || guard.busy()) return false;
    const request: LeaveRequest = {
      identity: options.identity(),
      scope: options.scope(),
      controller: new AbortController(),
      discard: false,
      saving: false,
      saved: false,
    };
    pending = request;
    const abort = () => {
      request.controller.abort();
      if (pending === request) pending = undefined;
    };
    context?.signal.addEventListener('abort', abort, { once: true });
    if (context?.signal.aborted) abort();
    const complete = (allowed: boolean) => {
      context?.signal.removeEventListener('abort', abort);
      if (pending === request) pending = undefined;
      if (!allowed || !isCurrent(request)) return false;
      const commit = () => {
        if (!isCurrent(request) || request.identity !== options.identity())
          return;
        if (request.discard || !options.dirty()) options.discard();
      };
      if (context) context.onCommit(commit);
      else commit();
      return true;
    };
    const result = guard.requestLeave(request.controller.signal);
    const completePending = async (result: Promise<boolean>) =>
      complete(await result);
    return typeof result === 'boolean'
      ? complete(result)
      : completePending(result);
  };
  const run = (action: () => void) => {
    const allowed = decide();
    if (typeof allowed === 'boolean') {
      if (allowed) action();
      return;
    }
    const completeAction = async () => {
      if (await allowed) action();
    };
    fireAndForget(completeAction(), 'draft-leave');
  };
  const warn = (event: BeforeUnloadEvent) => {
    if (!options.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  createEffect(() => {
    if (!options.dirty()) return;
    window.addEventListener('beforeunload', warn);
    onCleanup(() => window.removeEventListener('beforeunload', warn));
  });
  onCleanup(() => pending?.controller.abort());
  return { ...guard, decide, run };
}
