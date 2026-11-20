import { isRecord, type PaneId, useSplitRouter } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';

/** Read the current entry's origin, not the split's last visited origin. */
export function enteredFromWorkspaceDrawer(meta: unknown): boolean {
  return isRecord(meta) && meta.referredFrom === 'agents';
}

export function useWorkspaceDrawerEntry() {
  const router = useSplitRouter();
  const panel = useSplitPanelOrThrow();
  return () =>
    enteredFromWorkspaceDrawer(
      router.entry(panel.handle.id as string as PaneId)?.meta
    );
}
