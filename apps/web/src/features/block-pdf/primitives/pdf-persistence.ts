import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';

export function createPdfPersistence() {
  const [savingCount, setSavingCount] = createSignal(0);
  const isSaving: Accessor<boolean> = () => savingCount() > 0;
  const pending = new Set<Promise<void>>();

  const runSave = async (
    save: () => Promise<void>,
    shouldSave: () => boolean,
    options?: { throwOnError?: boolean }
  ) => {
    let saving = false;
    let operation: Promise<void> | undefined;
    try {
      if (!shouldSave()) return;
      saving = true;
      setSavingCount((previous) => previous + 1);
      operation = save();
      pending.add(operation);
      await operation;
    } catch (error) {
      console.error('Error saving PDF', error);
      if (options?.throwOnError) throw error;
    } finally {
      if (saving) {
        if (operation) pending.delete(operation);
        setSavingCount((previous) => previous - 1);
      }
    }
  };

  return {
    isSaving,
    runSave,
    async waitForSaves() {
      await Promise.all([...pending]);
    },
  };
}

export type PdfPersistence = ReturnType<typeof createPdfPersistence>;
