import type { Accessor } from 'solid-js';
import { type EmailTab, isExcludedEmailFolder } from '../constants';

type FolderRestoreOptions = {
  tab: Accessor<EmailTab>;
  isPending: Accessor<boolean>;
  /** Stable requested-key snapshot, replaced only when selection changes. */
  selection: Accessor<ReadonlySet<string>>;
  clearSelection: () => void;
  restore: (input: {
    folder: 'spam' | 'trash';
    threadIds: string[];
  }) => Promise<{ failedIds: string[] }>;
  onRestored: () => void;
  onFailed: (count: number) => void;
};

/** Restore the captured folder without clearing a newer list selection. */
export function createEmailFolderRestore(options: FolderRestoreOptions) {
  return async (threadIds: string[]) => {
    const folder = options.tab();
    if (!isExcludedEmailFolder(folder) || options.isPending()) return;
    const selection = options.selection();
    try {
      const result = await options.restore({ folder, threadIds });
      if (result.failedIds.length) {
        options.onFailed(result.failedIds.length);
      } else {
        if (options.selection() === selection) options.clearSelection();
        options.onRestored();
      }
    } catch {
      options.onFailed(threadIds.length);
    }
  };
}
