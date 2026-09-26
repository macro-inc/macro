import { createSignal } from 'solid-js';

/** Serialize writes without dimming controls on unrelated email rows. */
export function createEmailRowActionState() {
  const [pendingRowId, setPendingRowId] = createSignal<string>();

  return {
    isPending: (rowId: string) => pendingRowId() === rowId,
    async run(rowId: string, action: () => Promise<void>) {
      if (pendingRowId() !== undefined) return;

      setPendingRowId(rowId);
      try {
        await action();
      } finally {
        setPendingRowId(undefined);
      }
    },
  };
}
