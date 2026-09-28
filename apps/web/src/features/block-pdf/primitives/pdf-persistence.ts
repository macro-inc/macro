import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';

export function createPdfPersistence() {
  const [savingCount, setSavingCount] = createSignal(0);
  const isSaving: Accessor<boolean> = () => savingCount() > 0;

  const runSave = async (
    save: () => Promise<void>,
    shouldSave: () => boolean
  ) => {
    let saving = false;
    try {
      if (!shouldSave()) return;
      saving = true;
      setSavingCount((previous) => previous + 1);
      await save();
    } catch (error) {
      console.error('Error saving PDF', error);
    } finally {
      if (saving) {
        setSavingCount((previous) => previous - 1);
      }
    }
  };

  return {
    isSaving,
    runSave,
  };
}

export type PdfPersistence = ReturnType<typeof createPdfPersistence>;
