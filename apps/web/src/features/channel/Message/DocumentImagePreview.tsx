import type { MediaItem } from '@channel/Media/media-items';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import {
  fetchBinaryDocumentBlob,
  useBinaryDocumentQuery,
} from '@queries/storage/binary-document';
import { createMemo, createSignal, Show } from 'solid-js';
import { MediaPreview } from './MediaPreview';

/**
 * Shows an image document attached to a message inline, like an uploaded
 * image. Agents attach images they make as documents, so without this they
 * appear only as file chips. Other documents render nothing here; the message
 * keeps the document's chip either way.
 */
export function DocumentImagePreview(props: { documentId: string }) {
  // Same preview the attachment chip fetches, so this adds no request.
  const [preview] = useItemPreview(() => ({
    id: props.documentId,
    type: 'document',
  }));
  const isImage = () => {
    const item = preview();
    return (
      isAccessiblePreviewItem(item) &&
      fileTypeToResolvedBlockName(item.fileType) === 'image'
    );
  };
  const location = useBinaryDocumentQuery(() =>
    isImage() ? props.documentId : ''
  );

  // The query signs a new URL on every refetch, and a new src reloads the
  // image, so a message scrolled back into view would collapse and regrow.
  // Keep the URL the image loaded from and move to a newer one only after
  // that URL failed, which is how an expired one shows up. A fresh URL that
  // fails before it ever loaded leaves the chip alone; one that loaded and
  // expires later gets refreshed again.
  const [failedUrl, setFailedUrl] = createSignal<string>();
  const [gaveUp, setGaveUp] = createSignal(false);
  const shownUrl = createMemo<string | undefined>((shown) => {
    // A pending query's data read suspends the message list.
    const latest = location.isSuccess ? location.data : undefined;
    if (shown === undefined || shown === failedUrl()) return latest;
    return shown;
  });

  const items = createMemo<MediaItem[]>(() => {
    const url = shownUrl();
    if (!url || gaveUp()) return [];

    const documentId = props.documentId;
    return [
      {
        id: documentId,
        src: url,
        fullSrc: url,
        kind: 'image',
        getBlob: () => fetchBinaryDocumentBlob(documentId),
      },
    ];
  });

  const retryWithFreshUrl = () => {
    const url = shownUrl();
    const failed = failedUrl();
    // The failed URL can report again while its replacement is on its way.
    if (failed === url) return;

    if (failed !== undefined) {
      setGaveUp(true);
      return;
    }

    setFailedUrl(url);
    fireAndForget(location.refetch(), 'document-image-refetch');
  };

  return (
    <Show when={items().length > 0}>
      <MediaPreview
        items={items()}
        onError={retryWithFreshUrl}
        onLoad={() => setFailedUrl(undefined)}
      />
    </Show>
  );
}
