import type { NavigationStackChangeReason } from '@app/components/navigation-stack/NavigationStack';
import { toast } from '@core/component/Toast/Toast';
import { createSignal, onCleanup, useContext } from 'solid-js';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from './previewTarget';
import type { ContentIdentity } from './split-layout/contentInstanceRegistry';
import { SplitLayoutContext } from './split-layout/context';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

/** Call before changing selection. A rejected selection leaves the current preview intact. */
export function createPreviewSelectionGuard() {
  const layout = useContext(SplitLayoutContext);
  if (!layout) throw new Error('Preview selection requires a split layout');
  const manager = layout.manager;
  const panel = useSplitPanelOrThrow();
  const owner = Symbol('inline-preview');
  const [current, setCurrent] = createSignal<ContentIdentity>();
  const unregister = manager.registerOpenViews(() => {
    const content = current();
    return content
      ? [{ owner, content, activate: () => panel.handle.activate() }]
      : [];
  });
  onCleanup(unregister);

  return (
    selection: PreviewPanelSelection | undefined,
    reason: NavigationStackChangeReason = 'navigate'
  ) => {
    const target = selection && previewBlockTarget(selection);
    const next = target && { type: target.blockType, id: target.blockId };
    const existing = next && manager.findOpenView(next);
    if (existing && existing.owner !== owner) {
      if (reason === 'navigate') {
        existing.activate?.();
        toast.alert('Content already open');
      }
      return false;
    }
    setCurrent(next);
    return true;
  };
}
