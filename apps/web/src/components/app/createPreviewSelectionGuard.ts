import { toast } from '@core/component/Toast/Toast';
import type { ContentIdentity } from '@core/contentInstanceRegistry';
import { onCleanup } from 'solid-js';
import { useGlobalBlockOrchestrator } from './GlobalAppState';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from './previewTarget';

export type PreviewSelectionGuard = ((
  selection: PreviewPanelSelection | undefined
) => boolean) & {
  /** Checks a requested selection without claiming it before navigation commits. */
  canSelect: (selection: PreviewPanelSelection | undefined) => boolean;
};

/** Call after changing selection. Use canSelect before cancellable navigation. */
export function createPreviewSelectionGuard(): PreviewSelectionGuard {
  const registry = useGlobalBlockOrchestrator().contentInstances;
  const owner = Symbol('inline-preview');
  let current: ContentIdentity | undefined;
  const unregister = registry.register(() =>
    current ? [{ owner, content: current }] : []
  );
  onCleanup(unregister);

  const identity = (selection: PreviewPanelSelection | undefined) => {
    const target = selection && previewBlockTarget(selection);
    return target && { type: target.blockType, id: target.blockId };
  };
  const canSelect = (selection: PreviewPanelSelection | undefined) => {
    const next = identity(selection);
    if (next && registry.isOpenElsewhere(next, owner)) {
      toast.alert('Content already open');
      return false;
    }
    return true;
  };
  const select = (selection: PreviewPanelSelection | undefined) => {
    if (!canSelect(selection)) return false;
    current = identity(selection);
    return true;
  };

  return Object.assign(select, { canSelect });
}
