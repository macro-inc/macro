import type { SplitManager } from '@components/app/split-layout/layoutManager';
import type { AgentsPage } from '../core/pages';

/** Open a workspace page, also when an Agents split is already mounted. */
export function openAgentsPage(
  layout: Pick<SplitManager, 'openWithSplit'>,
  page: AgentsPage
) {
  const content = {
    type: 'component' as const,
    id: 'agents',
    preserveParams: true,
    params: { agentPage: page, agentPageRequest: crypto.randomUUID() },
  };
  const split = layout.openWithSplit(content, { activate: true }).split;
  if (!split) return;
  const current = split.content();
  if (
    current.type !== 'component' ||
    current.params?.agentPageRequest !== content.params.agentPageRequest
  ) {
    split.replace({ next: content, mergeHistory: true });
  }
}
