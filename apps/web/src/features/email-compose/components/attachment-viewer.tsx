import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { toast } from '@core/component/Toast/Toast';
import { getEmailAttachmentDownloadUrl } from '@queries/email/attachment';
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

  // Remote provider files require a fresh authorized download, never a raw
  // provider ID or a persisted bearer URL.
  const onClickFor = (attachment: DraftFormAttachment) => {
    if (attachment.type === 'native' && attachment.referenceUrl) {
      const url = attachment.referenceUrl;
      return () => window.open(url, '_blank', 'noopener,noreferrer');
    }
    if (attachment.type === 'native' || attachment.type === 'forwarded') {
      return () => {
        const kind = mediaKind(attachment.mimeType);
        // Open within the user gesture so browsers permit non-media downloads.
        const tab = kind ? undefined : window.open('', '_blank');
        if (tab) tab.opener = null;
        void getEmailAttachmentDownloadUrl(attachment.attachmentId)
          .then((url) => {
            if (kind)
              setItem({
                id: attachment.attachmentId,
                src: url,
                fullSrc: url,
                kind,
              });
            else if (tab) tab.location.replace(url);
          })
          .catch(() => {
            tab?.close();
            toast.failure('Unable to open this attachment');
          });
      };
    }
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
