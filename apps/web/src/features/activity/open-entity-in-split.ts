import { projectRouteId } from '@app/features/projects/core/route';
import { globalSplitManager } from '@app/signal/splitLayout';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { toast } from '@core/component/Toast/Toast';
import { enableProjects, isFeatureEnabled } from '@core/constant/featureFlags';
import type { OpenEntityTarget } from './context/activity-context';

/** The app's `onOpen` for activity rows: open the entity in the split layout. */
export function openEntityInSplit({
  block,
  id,
  params,
  newSplit,
}: OpenEntityTarget): void {
  if (block.toLowerCase() === 'initiative') {
    if (!isFeatureEnabled(enableProjects)) return;
    globalSplitManager()?.openWithSplit(
      {
        type: 'component',
        id: projectRouteId({
          id,
          section: 'overview',
          discussionId: params?.discussion_id,
        }),
      },
      { preferNewSplit: newSplit }
    );
    return;
  }
  const result = openDocument(block, id, params, newSplit);
  if (result?.status === 'reused' && result.owner !== result.sourceOwner) {
    toast.alert('Content already open');
  }
}
