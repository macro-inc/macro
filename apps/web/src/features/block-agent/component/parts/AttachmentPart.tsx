/**
 * A file the user attached to their prompt. Images and videos render as the
 * channel composer's media thumbnails and open the same lightbox; anything
 * else is a chip that opens the file. The fold hands over a URL, never bytes,
 * so this is a plain fetch from the static file service.
 */

import { getAttachmentKindFromFile } from '@channel/Input/utils/file-helpers';
import { MediaImage } from '@channel/Media/MediaImage';
import { MediaVideo } from '@channel/Media/MediaVideo';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { staticFileSizedUrl } from '@core/constant/servers';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { createSignal, Match, Show, Switch } from 'solid-js';

type AttachmentPartData = Extract<MessagePart, { kind: 'attachment' }>;

/**
 * `image`, `video`, or `file`, from the media type and then the name.
 *
 * The same classifier the composer's chips use, so a file renders the same
 * way before and after it is sent - a browser that reported no media type
 * for `shot.png` must not turn a thumbnail into a chip.
 */
export function attachmentMedium(part: {
  mimeType: string | null;
  name: string;
}): 'image' | 'video' | 'file' {
  const kind = getAttachmentKindFromFile({
    name: part.name,
    mimeType: part.mimeType ?? undefined,
  });
  return kind === 'document' ? 'file' : kind;
}

function fileExtension(name: string): string | undefined {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || extension === name.toLowerCase()) return undefined;
  return extension;
}

/** Last path segment of a static-file URL — the lightbox download name. */
function staticFileIdFromUri(uri: string): string {
  try {
    const last = new URL(uri).pathname.split('/').filter(Boolean).at(-1);
    return last ?? uri;
  } catch {
    return uri;
  }
}

function mediaItemFromAttachment(
  part: AttachmentPartData
): MediaItem | undefined {
  const kind = attachmentMedium(part);
  if (kind !== 'image' && kind !== 'video') return undefined;
  return {
    id: staticFileIdFromUri(part.uri),
    src: kind === 'image' ? staticFileSizedUrl(part.uri, 'medium') : part.uri,
    fullSrc: part.uri,
    kind,
  };
}

export function AttachmentPart(props: { part: AttachmentPartData }) {
  const medium = () => attachmentMedium(props.part);
  const [viewerOpen, setViewerOpen] = createSignal(false);
  const mediaItems = () => {
    const item = mediaItemFromAttachment(props.part);
    return item ? [item] : [];
  };
  const openViewer = () => setViewerOpen(true);

  return (
    <div class="ph-no-capture my-1 first:mt-0 last:mb-0" data-attachment-part>
      <Switch>
        <Match when={medium() === 'image'}>
          <button
            type="button"
            aria-label="Open image viewer"
            onClick={openViewer}
          >
            <MediaImage.Root>
              <MediaImage.Image
                src={staticFileSizedUrl(props.part.uri, 'medium')}
                class="max-h-64 max-w-full select-none rounded-lg border border-edge object-contain"
                loading="lazy"
                fallback={<MediaImage.Fallback square />}
              />
            </MediaImage.Root>
          </button>
        </Match>
        <Match when={medium() === 'video'}>
          <button
            type="button"
            aria-label="Open video viewer"
            onClick={openViewer}
          >
            <MediaVideo.Root class="group max-h-64 overflow-hidden border border-edge bg-surface">
              <MediaVideo.Preview
                src={props.part.uri}
                class="max-h-64 max-w-full object-contain"
              />
              <MediaVideo.PlayOverlay />
            </MediaVideo.Root>
          </button>
        </Match>
        <Match when={medium() === 'file'}>
          <a
            href={props.part.uri}
            target="_blank"
            rel="noreferrer"
            class="inline-flex max-w-full items-center gap-1.5 rounded-xs border border-edge-muted px-2 py-1 text-sm hover:bg-hover hover-transition-bg"
            title={props.part.name}
          >
            <EntityIcon
              targetType={fileTypeToBlockName(
                fileExtension(props.part.name),
                true
              )}
              size="xs"
            />
            <span class="truncate">{props.part.name}</span>
          </a>
        </Match>
      </Switch>
      <Show when={mediaItems().length > 0}>
        <MediaViewerDialog
          items={mediaItems}
          open={viewerOpen()}
          onOpenChange={setViewerOpen}
          currentIndex={() => 0}
          onCurrentIndexChange={() => {}}
        />
      </Show>
    </div>
  );
}
