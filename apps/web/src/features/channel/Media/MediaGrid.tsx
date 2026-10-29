import { FileDownloadButton } from '@core/component/FileDownload';
import { createFileDownload } from '@core/util/createFileDownload';
import ExpandIcon from '@icon/system/regular/arrows-out-simple.svg';
import { constrainImageDimensions } from '@macro-inc/lexical-core/utils/media';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { mediaDownloadSource } from '../queries/static-media-download';
import { MediaImage } from './MediaImage';
import { MediaVideo } from './MediaVideo';
import type { MediaItem } from './media-items';

// Square tile size in px; keep in sync with the `size-25.5` class and THUMB_SIZE.
const ATTACHMENT_TILE_SIZE = 102;
// Keep in sync with the `size-6.5` class.
const COMPACT_TILE_SIZE = 26;
const SINGLE_IMAGE_MAX_WIDTH = 400;
const SINGLE_IMAGE_MAX_HEIGHT = 400;
const MESSAGE_GALLERY_IMAGE_MAX_WIDTH = 200;
const MESSAGE_GALLERY_IMAGE_MAX_HEIGHT = 200;

function MessageImageTile(props: {
  item: MediaItem;
  large: boolean;
  onOpen: () => void;
  onError?: () => void;
}) {
  const dimensions = () =>
    constrainImageDimensions(
      props.item.width ?? undefined,
      props.item.height ?? undefined,
      props.large ? SINGLE_IMAGE_MAX_WIDTH : MESSAGE_GALLERY_IMAGE_MAX_WIDTH,
      props.large ? SINGLE_IMAGE_MAX_HEIGHT : MESSAGE_GALLERY_IMAGE_MAX_HEIGHT
    );

  return (
    <button
      type="button"
      class="relative flex rounded-2xl border border-edge"
      style={{
        width: dimensions() ? `${dimensions()!.width}px` : undefined,
        'max-width': '100%',
      }}
      onClick={props.onOpen}
      aria-label="Open image viewer"
    >
      <MediaImage.Image
        src={props.item.src}
        previewSrc={props.item.previewSrc}
        class="max-h-[80vh] w-full select-none rounded-2xl object-contain"
        width={dimensions()?.width ?? props.item.width ?? undefined}
        height={dimensions()?.height ?? props.item.height ?? undefined}
        fallback={<MediaImage.Fallback fill={!!dimensions()} />}
        onError={props.onError}
        style={{
          ...(dimensions()
            ? {
                'aspect-ratio': `${dimensions()!.width} / ${dimensions()!.height}`,
                'max-width': `${dimensions()!.width}px`,
              }
            : {
                'max-width': `${props.large ? SINGLE_IMAGE_MAX_WIDTH : MESSAGE_GALLERY_IMAGE_MAX_WIDTH}px`,
              }),
        }}
      />
    </button>
  );
}

function AttachmentImageTile(props: {
  item: MediaItem;
  onOpen?: () => void;
  /** A small thumbnail beside a collapsed message. */
  compact?: boolean;
}) {
  const size = () => (props.compact ? COMPACT_TILE_SIZE : ATTACHMENT_TILE_SIZE);
  return (
    // Root holds the fixed square; image and fallback both fill it (no reflow).
    <MediaImage.Root
      class={props.compact ? 'size-6.5 rounded-md' : 'size-25.5'}
    >
      <MediaImage.Image
        // Small thumbnail for these ~100px boxes; src is the fallback.
        src={props.item.thumbSrc ?? props.item.src}
        previewSrc={props.item.previewSrc}
        class={cn(
          'size-full select-none rounded-2xl border border-edge object-cover',
          props.compact && 'rounded-md',
          props.onOpen && 'hover:opacity-80'
        )}
        onOpen={props.onOpen}
        width={size()}
        height={size()}
        loading="lazy"
        fallback={
          <MediaImage.Fallback
            fill
            class={props.compact ? 'rounded-md' : undefined}
          />
        }
      />
    </MediaImage.Root>
  );
}

function MessageVideoTile(props: {
  item: MediaItem;
  onOpen: () => void;
  onError?: () => void;
}) {
  const download = createFileDownload(() => mediaDownloadSource(props.item));
  const [isInlinePlaying, setIsInlinePlaying] = createSignal(false);
  const src = () => props.item.src;
  const videoWidth = () => props.item.width ?? undefined;
  const videoHeight = () => props.item.height ?? undefined;

  return (
    <div class="flex min-w-0 max-w-120 flex-col overflow-hidden rounded-2xl border border-edge bg-surface">
      <div class="group/video relative flex min-h-20 max-h-120 min-w-0 overflow-hidden">
        <Show
          when={isInlinePlaying()}
          fallback={
            <>
              <button
                type="button"
                class="block max-w-full"
                onClick={props.onOpen}
                aria-label="Open video viewer"
              >
                <MediaVideo.Preview
                  src={props.item.src}
                  class="block max-h-120 max-w-full"
                  width={videoWidth()}
                  height={videoHeight()}
                  onError={props.onError}
                />
                <MediaVideo.PlayOverlay class="[&_svg]:size-6" />
              </button>
              <button
                type="button"
                class="absolute bottom-2 left-2 rounded-md bg-surface/90 px-2 py-1 text-xs font-medium text-ink shadow-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsInlinePlaying(true);
                }}
              >
                Play inline
              </button>
            </>
          }
        >
          <video
            class="block max-h-120 max-w-full"
            controls
            autoplay
            playsinline
            src={src()}
            width={videoWidth()}
            height={videoHeight()}
            onError={() => props.onError?.()}
          />
        </Show>
        <div
          class={cn(
            'absolute right-2 top-2 z-10 flex items-center rounded-full bg-surface/90 opacity-0 transition-opacity group-hover/video:opacity-100 group-focus-within/video:opacity-100 touch:opacity-100',
            download.phase() !== 'idle' && 'opacity-100'
          )}
        >
          <FileDownloadButton download={download} iconOnly />
          <Button
            variant="ghost"
            size="icon-md"
            aria-label="Open video viewer"
            tooltip="Open video viewer"
            onClick={(event) => {
              event.stopPropagation();
              props.onOpen();
            }}
          >
            <ExpandIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AttachmentVideoTile(props: {
  item: MediaItem;
  onOpen?: () => void;
  compact?: boolean;
}) {
  return (
    <MediaVideo.Root
      class={cn(
        'size-25.5 group overflow-hidden border border-edge bg-surface',
        props.compact && 'size-6.5 rounded-md'
      )}
    >
      <MediaVideo.Preview
        src={props.item.src}
        class="size-full object-cover"
        onOpen={props.onOpen}
      />
      <MediaVideo.PlayOverlay
        onOpen={props.onOpen}
        class={props.compact ? '[&_svg]:size-3' : undefined}
      />
    </MediaVideo.Root>
  );
}

export function MediaGrid(props: {
  items: MediaItem[];
  /** `compact` shows every item as a small thumbnail. */
  variant: 'message' | 'attachments' | 'compact';
  onOpen: (index: number) => void;
  /** An item whose file failed to load (message tiles only). */
  onError?: (id: string) => void;
  class?: string;
}) {
  const hasSingleLargeImage = createMemo(
    () => props.items.length === 1 && props.items[0]?.kind === 'image'
  );

  return (
    <div
      class={cn(
        props.variant === 'message'
          ? 'flex flex-row flex-wrap gap-2'
          : 'flex flex-row flex-wrap gap-1.5',
        props.class
      )}
    >
      <For each={props.items}>
        {(item, index) => (
          <Switch>
            <Match when={item.kind === 'image' && props.variant === 'message'}>
              <MessageImageTile
                item={item}
                large={hasSingleLargeImage()}
                onOpen={() => props.onOpen(index())}
                onError={() => props.onError?.(item.id)}
              />
            </Match>
            <Match when={item.kind === 'image'}>
              <AttachmentImageTile
                item={item}
                compact={props.variant === 'compact'}
                onOpen={() => props.onOpen(index())}
              />
            </Match>
            <Match when={item.kind === 'video' && props.variant === 'message'}>
              <MessageVideoTile
                item={item}
                onOpen={() => props.onOpen(index())}
                onError={() => props.onError?.(item.id)}
              />
            </Match>
            <Match when={true}>
              <AttachmentVideoTile
                item={item}
                compact={props.variant === 'compact'}
                onOpen={() => props.onOpen(index())}
              />
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
