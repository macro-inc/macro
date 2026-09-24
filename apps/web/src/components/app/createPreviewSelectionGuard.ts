import type { NavigationStackChangeReason } from '@app/components/navigation-stack/NavigationStack';
import { toast } from '@core/component/Toast/Toast';
import { createSignal, onCleanup, untrack, useContext } from 'solid-js';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from './previewTarget';
import type { ContentIdentity } from './split-layout/contentInstanceRegistry';
import { SplitLayoutContext } from './split-layout/context';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

type SelectPreview = (
  selection: PreviewPanelSelection | undefined,
  reason?: NavigationStackChangeReason
) => boolean;

export type PreviewSelectionGuard = SelectPreview & {
  /** Checks a requested selection without claiming it before navigation commits. */
  canSelect: SelectPreview;
};

/** Call after changing selection. Use canSelect before cancellable navigation. */
export function createPreviewSelectionGuard(): PreviewSelectionGuard {
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

  const identity = (selection: PreviewPanelSelection | undefined) => {
    const target = selection && previewBlockTarget(selection);
    return target && { type: target.blockType, id: target.blockId };
  };
  const canSelect: SelectPreview = (selection, reason = 'navigate') =>
    untrack(() => {
      const next = identity(selection);
      const existing = next && manager.findOpenView(next);
      if (existing && existing.owner !== owner) {
        if (reason === 'navigate') {
          existing.activate?.();
          toast.alert('Content already open');
        }
        return false;
      }
      return true;
    });
  const select: SelectPreview = (selection, reason) => {
    if (!canSelect(selection, reason)) return false;
    setCurrent(identity(selection));
    return true;
  };

  return Object.assign(select, { canSelect });
}
