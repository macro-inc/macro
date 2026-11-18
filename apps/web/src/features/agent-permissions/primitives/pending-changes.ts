import type {
  ToolPermissionChange,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { ResultAsync } from 'neverthrow';
import { createStore, produce } from 'solid-js/store';
import { targetKey } from '../core/model';

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
  // A later click on the same control supersedes an earlier one's cleanup.
  const latest: Record<string, number> = {};
  let sequence = 0;

  const settle = (key: string, id: number) => {
    if (latest[key] !== id) return;
    delete latest[key];
    setPending(
      produce((draft) => {
        delete draft[key];
      })
    );
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

    /**
     * Saves `change`, showing `shown` on its control meanwhile (a cleared
     * tool rule shows its action's state).
     */
    async apply(change: ToolPermissionChange, shown: ToolPermissionState) {
      const key = targetKey(change.target);
      const id = ++sequence;
      latest[key] = id;
      setPending(key, shown);
      const saved = await ResultAsync.fromPromise(
        capabilities.save(change),
        (error) => error
      );
      if (saved.isErr()) capabilities.onFailure(change, saved.error);
      settle(key, id);
    },
  };
}

export type PendingChanges = ReturnType<typeof createPendingChanges>;
