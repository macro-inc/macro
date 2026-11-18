import type { MediaItem } from '@channel/Media/media-items';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { createMemo, Show } from 'solid-js';
import { MediaPreview } from './MediaPreview';

/**
 * Shows an image document attached to a message inline, like an uploaded
 * image. Agents attach images they make as documents, so without this they
 * appear only as file chips. Other documents render nothing here; the message
 * keeps the document's chip either way.
 */
export function DocumentImagePreview(props: { documentId: string }) {
  const [preview] = useItemPreview(() => ({
    id: props.documentId,
    type: 'document',
  }));
  const isImage = createMemo(() => {
    const item = preview();
    return (
      isAccessiblePreviewItem(item) &&
      fileTypeToBlockName(item.fileType) === 'image'
    );
  });
  const location = useBinaryDocumentQuery(() =>
    isImage() ? props.documentId : ''
  );
  const items = createMemo<MediaItem[]>(() => {
    // A pending query's data read suspends the message list; read it only
    // once it has a value.
    const url = location.isSuccess ? location.data : undefined;
    if (!url) return [];
    return [{ id: props.documentId, src: url, fullSrc: url, kind: 'image' }];
  });

  // The URL is presigned and expires; refetch once when the image fails, so a
  // channel left open recovers without retrying a URL that will never load.
  let refetched = false;
  const refetchExpiredUrl = () => {
    if (refetched) return;
    refetched = true;
    fireAndForget(location.refetch(), 'document-image-refetch');
  };

  return (
    <Show when={items().length > 0}>
      <MediaPreview items={items()} onError={refetchExpiredUrl} />
    </Show>
  );
}
