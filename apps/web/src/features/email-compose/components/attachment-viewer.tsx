import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { createSignal, onCleanup } from 'solid-js';
import type { DraftFormAttachment } from '../primitives/email-form-state';

function mediaKind(mimeType: string): MediaItem['kind'] | undefined {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
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

  const open = (file: File, kind: MediaItem['kind']) => {
    release();
    objectUrl = URL.createObjectURL(file);
    setItem({ id: objectUrl, src: objectUrl, fullSrc: objectUrl, kind });
  };

  // Only files added in this session have viewable bytes; saved draft and
  // forwarded attachments carry an S3 key or provider id, not a URL.
  const onClickFor = (attachment: DraftFormAttachment) => {
    if (attachment.type !== 'local') return undefined;
    const { file } = attachment;
    const kind = mediaKind(file.type);
    return kind ? () => open(file, kind) : undefined;
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
