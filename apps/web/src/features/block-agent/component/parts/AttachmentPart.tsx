/**
 * A file the user attached to their prompt. Images and videos render as the
 * channel composer's media thumbnails; anything else is a chip that opens
 * the file. The fold hands over a URL, never bytes, so this is a plain
 * fetch from the static file service.
 */

import { getAttachmentKindFromFile } from '@channel/Input/utils/file-helpers';
import { MediaImage } from '@channel/Media/MediaImage';
import { MediaVideo } from '@channel/Media/MediaVideo';
import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { staticFileSizedUrl } from '@core/constant/servers';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { Match, Switch } from 'solid-js';

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

export function AttachmentPart(props: { part: AttachmentPartData }) {
  const medium = () => attachmentMedium(props.part);

  return (
    <div class="ph-no-capture my-1 first:mt-0 last:mb-0" data-attachment-part>
      <Switch>
        <Match when={medium() === 'image'}>
          <a href={props.part.uri} target="_blank" rel="noreferrer">
            <MediaImage.Root>
              <MediaImage.Image
                src={staticFileSizedUrl(props.part.uri, 'medium')}
                class="max-h-64 max-w-full select-none rounded-lg border border-edge object-contain"
                loading="lazy"
                fallback={<MediaImage.Fallback square />}
              />
            </MediaImage.Root>
          </a>
        </Match>
        <Match when={medium() === 'video'}>
          <a href={props.part.uri} target="_blank" rel="noreferrer">
            <MediaVideo.Root class="group max-h-64 overflow-hidden border border-edge bg-surface">
              <MediaVideo.Preview
                src={props.part.uri}
                class="max-h-64 max-w-full object-contain"
              />
              <MediaVideo.PlayOverlay />
            </MediaVideo.Root>
          </a>
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
    </div>
  );
}
