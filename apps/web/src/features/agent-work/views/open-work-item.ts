import { useSplitLayout } from '@components/app/split-layout/layout';
import type { WorkItem } from '../core/work-item';

/** Opens a registered session beside whatever you're in, keeping it live. */
export function useOpenWorkItem() {
  const layout = useSplitLayout();

  return (item: WorkItem) =>
    layout?.openWithSplit(
      { type: 'agent', id: item.sessionId },
      { activate: true, preferNewSplit: true }
    );
}
