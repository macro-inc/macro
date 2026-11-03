import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { projectHostedContent } from '@app/features/projects/open-project';
import { globalSplitManager } from '@app/signal/splitLayout';
import { Telemetry } from '@macro-inc/observability';
import type { FeedActions } from './context/feed-source';

/** Open real app surfaces; a proposed action is reviewed in the agent composer before sending. */
export const feedActions: FeedActions = {
  start: (item) =>
    Telemetry.span('for_you.open_agent', async (span) => {
      span.setAttr('suggestion.action', item.action);
      span.setAttr('suggestion.kind', item.kind);
      await openChatWithInput(item.prompt);
    }),
  openSource: (item) => {
    const source = item.sourceEntity;
    if (!source) return;
    globalSplitManager()?.openWithSplit(
      source.type === 'initiative'
        ? projectHostedContent(source.id, 'overview')
        : { type: source.type, id: source.id },
      { activate: true, preferNewSplit: true }
    );
  },
};
