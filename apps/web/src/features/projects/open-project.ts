import type { useSplitLayout } from '@components/app/split-layout/layout';
import { enableProjects, isFeatureEnabled } from '@core/constant/featureFlags';
import type { ProjectSection } from './core/project';
import { projectRouteId } from './core/route';

/** A host action, deliberately outside the reusable feature layers. */
export function openProject(
  layout: ReturnType<typeof useSplitLayout>,
  id: string,
  options: {
    section?: ProjectSection;
    newSplit?: boolean;
    discussionId?: string;
  } = {}
) {
  if (!isFeatureEnabled(enableProjects)) return;
  layout.openWithSplit(
    {
      type: 'component',
      id: projectRouteId({
        id,
        section: options.discussionId
          ? 'overview'
          : (options.section ?? 'overview'),
        discussionId: options.discussionId,
      }),
    },
    { preferNewSplit: options.newSplit }
  );
}
