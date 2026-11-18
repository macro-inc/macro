import { MediaImage } from '@channel/Media/MediaImage';
import { MediaVideo } from '@channel/Media/MediaVideo';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  staticFileIdEndpoint,
  staticFileSizedEndpoint,
} from '@core/constant/servers';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { Match, Show, Switch } from 'solid-js';
import type { InputAttachmentData } from './types';

const TILE_SIZE = 28;

function PendingThumbnail() {
  return (
    <div class="flex size-full items-center justify-center">
      <SpinnerIcon class="size-3 animate-spin" />
    </div>
  );
}

function AttachmentThumbnail(props: { attachment: InputAttachmentData }) {
  const isPending = () => !!props.attachment.pending;

  return (
    <Switch fallback={<PendingThumbnail />}>
      <Match
        when={
          props.attachment.kind === 'image' &&
          (!isPending() || props.attachment.previewSrc)
        }
      >
        {/* The size the expanded attachment strip loads, so collapsing
            and expanding share one cached image. */}
        <MediaImage.Image
          src={staticFileSizedEndpoint(props.attachment.id, 'medium')}
          previewSrc={props.attachment.previewSrc}
          class="size-full object-cover"
          width={TILE_SIZE}
          height={TILE_SIZE}
          fallback={<PendingThumbnail />}
        />
      </Match>
      <Match when={props.attachment.kind === 'video' && !isPending()}>
        <MediaVideo.Preview
          src={staticFileIdEndpoint(props.attachment.id)}
          class="size-full object-cover"
        />
      </Match>
      <Match when={props.attachment.kind === 'document' && !isPending()}>
        <div class="flex size-full items-center justify-center">
          <EntityIcon
            targetType={props.attachment.iconType ?? 'unknown'}
            size="xs"
          />
        </div>
      </Match>
    </Switch>
  );
}

/**
 * A draft's attachments in a collapsed composer: a thumbnail of the first
 * one, with the number of attachments over it when there are several.
 */
export function CollapsedAttachmentPreview(props: {
  attachments?: InputAttachmentData[];
}) {
  const count = () => props.attachments?.length ?? 0;

  return (
    <Show when={props.attachments?.[0]}>
      {(first) => (
        <div
          role="img"
          aria-label={`${count()} attachment${count() === 1 ? '' : 's'}`}
          // The tap belongs to the collapsed input, which opens the composer.
          class="ph-no-capture pointer-events-none relative size-7 shrink-0 overflow-hidden rounded-md border border-edge bg-surface"
          data-collapsed-input-attachment-preview
        >
          <AttachmentThumbnail attachment={first()} />
          <Show when={count() > 1}>
            <span class="absolute inset-0 flex items-center justify-center bg-surface/60 text-xs font-medium text-ink">
              {count()}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
