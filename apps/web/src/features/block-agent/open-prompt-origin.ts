import { callsHostedContent } from '@app/features/calls-view/calls-hosted-content';
import { documentCommentLocation } from '@app/features/notifications/document-comment-location';
import { openProject } from '@app/features/projects/open-project';
import { routineContent } from '@app/features/routines/routine-navigation';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { toast } from '@core/component/Toast/Toast';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import { getItemPreview, isAccessiblePreviewItem } from '@queries/preview';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { OriginDestination } from './state/prompt-origin';

/**
 * Opens the place a prompt came from: a host action, deliberately outside the
 * feature layers. Called during setup: it reads the split layout from context.
 */
export function useOpenPromptOrigin(): (
  destination: OriginDestination
) => void {
  const layout = useSplitLayout();

  /** A document's block depends on its file type, which the context omits. */
  const openDocumentComment = async (
    documentId: string,
    commentId: string | undefined
  ) => {
    const preview = await ResultAsync.fromPromise(
      getItemPreview({ id: documentId, type: 'document' }),
      () => 'unreadable' as const
    );
    if (
      preview.isErr() ||
      !isAccessiblePreviewItem(preview.value) ||
      preview.value.type !== 'document'
    ) {
      toast.failure("Couldn't open that document");
      return;
    }
    const location = documentCommentLocation(commentId ?? '', {
      fileType: preview.value.fileType,
      subType: preview.value.subType,
    });
    openDocument(
      location.blockName,
      documentId,
      commentId ? location.params : undefined
    );
  };

  return (destination) =>
    match(destination)
      .with({ kind: 'channel_message' }, (target) => {
        const orchestrator = globalSplitManager()?.getOrchestrator();
        if (target.messageId && orchestrator) {
          fireAndForget(
            navigateToChannelMessage(
              orchestrator,
              target.channelId,
              target.messageId,
              target.threadId
            ),
            'agent-prompt-origin'
          );
          return;
        }
        layout.openWithSplit({ type: 'channel', id: target.channelId });
      })
      .with({ kind: 'document' }, ({ documentId, commentId }) => {
        fireAndForget(
          openDocumentComment(documentId, commentId),
          'agent-prompt-origin'
        );
      })
      .with({ kind: 'project' }, ({ projectId, commentId }) =>
        openProject(layout, projectId, { discussionId: commentId })
      )
      .with({ kind: 'crm_company' }, ({ companyId, commentId }) => {
        openDocument(
          'company',
          companyId,
          commentId ? { [COMMENT_LINK_PARAM]: commentId } : undefined
        );
      })
      .with({ kind: 'crm_contact' }, ({ contactId, commentId }) => {
        openDocument(
          'contact',
          contactId,
          commentId ? { [COMMENT_LINK_PARAM]: commentId } : undefined
        );
      })
      .with({ kind: 'call' }, ({ callId }) => {
        const content = callsHostedContent({ type: 'call', id: callId });
        if (content) layout.openWithSplit(content);
      })
      .with({ kind: 'task' }, ({ taskId }) => {
        layout.openWithSplit({ type: 'task', id: taskId });
      })
      .with({ kind: 'routine' }, ({ routineId }) => {
        layout.openWithSplit(routineContent(routineId), { activate: true });
      })
      .with({ kind: 'email_thread' }, ({ threadId }) => {
        layout.openWithSplit({ type: 'email', id: threadId });
      })
      .with({ kind: 'agent_session' }, ({ sessionId }) => {
        layout.openWithSplit(
          { type: 'agent', id: sessionId },
          { activate: true }
        );
      })
      .with({ kind: 'external' }, ({ url }) => openExternalUrl(url))
      .exhaustive();
}
