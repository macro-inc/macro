import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { getVisibleUserMessageAttachments } from '@core/component/AI/component/message/userMessageAttachments';
import { itemToBlockName } from '@core/constant/allBlocks';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core/utils/mentions';
import { getItemPreview, isAccessiblePreviewItem } from '@queries/preview';
import { stringToItemType } from '@service-storage/itemType';

/** Agent prompts carry context as markdown mentions instead of a separate attachment list. */
export async function buildHomeAgentPrompt(
  request: Pick<ChatSendInput, 'content' | 'attachments'>
): Promise<string> {
  const { images, items } = getVisibleUserMessageAttachments(
    request.content,
    request.attachments
  );
  if (images.length) {
    throw new Error(
      'Image attachments are not supported in agent sessions yet.'
    );
  }
  const mentions = await Promise.all(
    items.map(async (attachment) => {
      const type = stringToItemType(attachment.entity_type);
      if (!type)
        throw new Error('Could not attach this item to the agent session.');
      const preview = await getItemPreview({ id: attachment.entity_id, type });
      if (!isAccessiblePreviewItem(preview)) {
        throw new Error('Could not load an attachment. Please try again.');
      }
      return buildMentionMarkdownString({
        type: 'document',
        blockParams: {},
        documentId: attachment.entity_id,
        documentName: preview.name,
        blockName: itemToBlockName(preview),
      });
    })
  );
  return [request.content, ...mentions].filter(Boolean).join('\n\n');
}
