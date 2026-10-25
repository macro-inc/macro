import { paneRoute } from '@app/routes/app-route';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { enableProjects, isFeatureEnabled } from '@core/constant/featureFlags';
import { Telemetry } from '@macro-inc/observability';
import type { ProjectSection } from './core/project';

/**
 * The Tasks-hosted project route as split content. Its identity is the project
 * itself, so an open project split is found and retargeted; the legacy
 * `initiative-view` component would mount a redirect shim beside it instead.
 */
export function projectHostedContent(
  id: string,
  section: ProjectSection,
  discussionId?: string
): SplitContent {
  return {
    type: 'initiative',
    id,
    entryMetadata: {
      route: paneRoute(
        { id: 'view-tasks', params: {} },
        { id: 'tasks-project', params: { projectId: id, section } }
      ),
      search: {
        tasks: { tab: ['projects'] },
        ...(discussionId ? { project: { discussionId: [discussionId] } } : {}),
      },
    },
  };
}

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
  const section = options.discussionId
    ? 'overview'
    : (options.section ?? 'overview');
  const content = projectHostedContent(id, section, options.discussionId);
  const span = Telemetry.span('project.open');
  try {
    span.setAttr('project.id', id);
    span.setAttr('project.section', section);
    span.setAttr('project.has_discussion', options.discussionId !== undefined);
    // A project already on screen moves to the requested section or comment
    // in place; opening it again would only add an empty pane.
    const existing = globalSplitManager()?.getSplitByContent('initiative', id);
    if (existing) {
      existing.replace({
        next: content,
        mergeHistory: true,
        referredFrom: null,
      });
      existing.activate();
      span.setAttr('project.outcome', 'retargeted');
      return;
    }
    const result = layout.openWithSplit(content, {
      preferNewSplit: options.newSplit,
    });
    span.setAttr('project.outcome', result?.status ?? 'unavailable');
  } finally {
    span.end();
  }
}
