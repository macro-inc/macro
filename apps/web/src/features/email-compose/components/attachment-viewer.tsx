import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { createSignal, onCleanup } from 'solid-js';
import type { DraftFormAttachment } from '../primitives/email-form-state';

function mediaKind(mimeType: string): MediaItem['kind'] | undefined {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return undefined;
}

function viewableKind(attachment: DraftFormAttachment) {
  if (attachment.type === 'local') return mediaKind(attachment.file.type);
  if (attachment.type === 'remote') return mediaKind(attachment.contentType);
  // Forwarded attachments have no URL until the draft is sent.
  return undefined;
}

/** Opens image and video attachment chips in the media viewer. */
export function createAttachmentViewer() {
  const [item, setItem] = createSignal<MediaItem>();
  let objectUrl: string | undefined;

  const release = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };
  onCleanup(release);

  const open = (attachment: DraftFormAttachment, kind: MediaItem['kind']) => {
    release();
    let src: string;
    if (attachment.type === 'local') {
      objectUrl = URL.createObjectURL(attachment.file);
      src = objectUrl;
    } else if (attachment.type === 'remote') {
      src = attachment.url;
    } else {
      return;
    }
    setItem({ id: attachment.attachmentId ?? src, src, fullSrc: src, kind });
  };

  const onClickFor = (attachment: DraftFormAttachment) => {
    const kind = viewableKind(attachment);
    return kind ? () => open(attachment, kind) : undefined;
  };

  const Viewer = () => (
    <MediaViewerDialog
      items={() => {
        const current = item();
        return current ? [current] : [];
      }}
      open={item() !== undefined}
      onOpenChange={(isOpen) => {
        if (isOpen) return;
        setItem(undefined);
        release();
      }}
      currentIndex={() => 0}
      onCurrentIndexChange={() => {}}
    />
  );

  return { onClickFor, Viewer };
}
