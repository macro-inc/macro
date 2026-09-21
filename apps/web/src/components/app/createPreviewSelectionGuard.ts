import { toast } from '@core/component/Toast/Toast';
import type { ContentIdentity } from '@core/contentInstanceRegistry';
import { onCleanup } from 'solid-js';
import { useGlobalBlockOrchestrator } from './GlobalAppState';
import { type PreviewPanelSelection, previewTarget } from './previewTarget';

/** Call before changing selection. A rejected selection leaves the current preview intact. */
export function createPreviewSelectionGuard() {
  const registry = useGlobalBlockOrchestrator().contentInstances;
  const owner = Symbol('inline-preview');
  let current: ContentIdentity | undefined;
  const unregister = registry.register(() =>
    current ? [{ owner, content: current }] : []
  );
  onCleanup(unregister);

  return (selection: PreviewPanelSelection | undefined) => {
    const target = selection && previewTarget(selection);
    const next = target
      ? target.kind === 'block'
        ? { type: target.blockType, id: target.blockId }
        : target.content
      : undefined;
    if (next && registry.isOpenElsewhere(next, owner)) {
      toast.alert('Content already open');
      return false;
    }
    current = next;
    return true;
  };
}
