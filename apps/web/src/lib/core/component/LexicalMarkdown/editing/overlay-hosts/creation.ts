import type { ComposeDocumentProps } from '@app/features/block-md/views/compose-document';
import { globalSplitManager } from '@app/signal/splitLayout';
import { trackMention } from '@core/signal/mention';
import { nanoid } from 'nanoid';
import type { ActionContext } from '../../plugins/actions/types';

export type CreationKind = 'task' | 'document';
export type CreationComposerCallbacks = Required<
  Pick<ComposeDocumentProps, 'onCreateStart' | 'onCreateFailure' | 'onSuccess'>
>;

/** True reports an actual composer-open request, never an editor insertion. */
export function openCreationComposer(
  kind: CreationKind,
  createCallbacks: (awaitId: string) => CreationComposerCallbacks
): boolean {
  const splitManager = globalSplitManager();
  if (!splitManager) return false;
  const awaitId = nanoid(21);
  splitManager.createPopoverSplit({
    content: {
      type: 'component',
      id: kind === 'task' ? 'task-compose' : 'document-compose',
      params: createCallbacks(awaitId),
    },
  });
  return true;
}

export async function trackSlashCreatedMention(
  context: ActionContext | undefined,
  documentId: string
) {
  if (
    !context?.sourceDocumentId ||
    context.disableMentionTracking ||
    context.sourceBlockName === 'channel' ||
    context.sourceBlockName === 'chat'
  )
    return undefined;

  return await trackMention(context.sourceDocumentId, 'document', documentId);
}
