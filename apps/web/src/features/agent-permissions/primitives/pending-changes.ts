import type {
  ToolPermissionChange,
  ToolPermissionState,
  ToolPermissionTarget,
} from '@service-agent-harness/generated/schemas';
import { ResultAsync } from 'neverthrow';
import { createStore, produce } from 'solid-js/store';
import {
  changeForTool,
  type ToolRef,
  targetKey,
  toolTarget,
} from '../core/model';

/**
 * Saves one change at a time per click and shows each control's chosen
 * state until the server answers. The server's answer then replaces the
 * whole view (the query cache), so nothing here is optimistic beyond the
 * clicked control; a failure drops the pending state, which snaps the
 * control back to the saved one.
 */
export function createPendingChanges(capabilities: {
  /** Persists `change`; rejects when the server refused or was unreachable. */
  save: (change: ToolPermissionChange) => Promise<unknown>;
  onFailure: (change: ToolPermissionChange, error: unknown) => void;
}) {
  // Keyed by `targetKey`: the state the control should show meanwhile.
  const [pending, setPending] = createStore<
    Record<string, ToolPermissionState>
  >({});
  // Each control's latest save, resolving to whether it saved. A later
  // click on the same control supersedes an earlier one's cleanup.
  const latest: Record<string, Promise<boolean>> = {};

  const send = async (change: ToolPermissionChange) => {
    const saved = await ResultAsync.fromPromise(
      capabilities.save(change),
      (error) => error
    );
    if (saved.isErr()) capabilities.onFailure(change, saved.error);
    return saved.isOk();
  };

  const settle = (key: string, outcome: Promise<boolean>) => {
    if (latest[key] !== outcome) return;
    delete latest[key];
    setPending(
      produce((draft) => {
        delete draft[key];
      })
    );
  };

  /**
   * Saves `change` to `target`, showing `shown` on its control meanwhile
   * (a cleared tool rule shows its action's state). A change that waits on
   * another is passed as a promise and sent once decided.
   */
  const apply = async (
    target: ToolPermissionTarget,
    shown: ToolPermissionState,
    change: ToolPermissionChange | Promise<ToolPermissionChange>
  ) => {
    const key = targetKey(target);
    setPending(key, shown);
    // A decided change is sent now, so clicks reach the queue in order.
    const outcome =
      change instanceof Promise ? change.then(send) : send(change);
    latest[key] = outcome;
    await outcome;
    settle(key, outcome);
  };

  return {
    /** The state a control shows while its change saves, if one is saving. */
    pendingState(key: string): ToolPermissionState | undefined {
      return pending[key];
    },

    /** Any change still saving. */
    saving(): boolean {
      return Object.keys(pending).length > 0;
    },

    apply,

    /**
     * Sets `tool` to `state`, given `saved`, the state its action
     * (`action`) is saved in. A tool set to its action's state follows the
     * action (`null`). While the action's own change saves, the tool's
     * waits for it and compares with the state the action ends up in: the
     * new one if it saved, `saved` if it failed, so a failed action save
     * can't leave the tool following the wrong state.
     */
    setTool(
      action: ToolPermissionTarget,
      saved: ToolPermissionState,
      tool: ToolRef,
      state: ToolPermissionState
    ) {
      const actionKey = targetKey(action);
      const actionPending = pending[actionKey];
      const actionOutcome = latest[actionKey];
      const change =
        actionPending && actionOutcome
          ? actionOutcome.then((ok) =>
              changeForTool(ok ? actionPending : saved, tool, state)
            )
          : changeForTool(saved, tool, state);
      return apply(toolTarget(tool), state, change);
    },
  };
}

export type PendingChanges = ReturnType<typeof createPendingChanges>;
