import type { SplitPanelContextType } from '@components/app/split-layout/context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';

/**
 * An inline preview (e.g. a folder opened from Home) shares its host's panel,
 * whose content is the host's list view. The soup list derives its view, tab
 * presets, and persisted filters from that content, so it would treat the
 * folder as the host view and drop the folder's own filters. Scope the
 * content to this project, as it is when the folder has its own split.
 */
export function useProjectScopedPanel(
  projectId: string
): SplitPanelContextType {
  const panel = useSplitPanelOrThrow();
  if (!panel.isInlinePreview) return panel;
  return {
    ...panel,
    handle: {
      ...panel.handle,
      content: () => ({ type: 'project', id: projectId }),
    },
  };
}
