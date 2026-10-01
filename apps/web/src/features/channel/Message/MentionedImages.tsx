import { ImageDocumentCard } from '@core/component/ImageDocumentCard';
import {
  fileTypeToResolvedBlockName,
  verifyBlockName,
} from '@core/constant/allBlocks';
import {
  type DocumentMentionRef,
  getDocumentMentions,
} from '@core/util/documentMentions';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { blockNameToItemType } from '@service-storage/itemType';
import { createMemo, For, Show } from 'solid-js';

/** Mentions that can resolve to a stored document; channels, chats, and the like never unfurl. */
function isDocumentMention(mention: DocumentMentionRef): boolean {
  return blockNameToItemType(verifyBlockName(mention.blockName)) === 'document';
}

function MentionedImage(props: { documentId: string }) {
  // Same preview the mention chip in the text fetches, so this adds no request.
  const [item] = useItemPreview(() => ({
    id: props.documentId,
    type: 'document',
  }));
  const image = () => {
    const preview = item();
    if (!isAccessiblePreviewItem(preview) || preview.type !== 'document') {
      return;
    }
    if (fileTypeToResolvedBlockName(preview.fileType) !== 'image') return;
    return preview;
  };

  return (
    <Show when={image()}>
      {(document) => (
        <div class="mt-2 max-w-md">
          <ImageDocumentCard
            documentId={document().id}
            fileName={document().name}
          />
        </div>
      )}
    </Show>
  );
}

/**
 * Image documents mentioned in a message, shown as inline previews beneath
 * its text. The mention chip in the text stays; this is what the chip
 * points at, so a generated or shared picture is seen without opening it.
 */
export function MentionedImages(props: { content: string }) {
  const documentIds = createMemo(() =>
    getDocumentMentions(props.content)
      .filter(isDocumentMention)
      .map((mention) => mention.documentId)
  );

  return (
    <Show when={documentIds().length > 0}>
      <div class="flex flex-wrap gap-x-2" data-message-mentioned-images>
        <For each={documentIds()}>
          {(documentId) => <MentionedImage documentId={documentId} />}
        </For>
      </div>
    </Show>
  );
}
