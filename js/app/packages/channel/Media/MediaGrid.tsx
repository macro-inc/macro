import ExpandIcon from '@icon/regular/arrows-out-simple.svg';
import { constrainImageDimensions } from '@lexical-core/utils/media';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { MediaImage } from './MediaImage';
import { MediaVideo } from './MediaVideo';
import type { MediaItem } from './media-items';

const ATTACHMENT_TILE_SIZE = 92;
const SINGLE_IMAGE_MAX_WIDTH = 400;
const SINGLE_IMAGE_MAX_HEIGHT = 400;
const MESSAGE_GALLERY_IMAGE_MAX_WIDTH = 200;
const MESSAGE_GALLERY_IMAGE_MAX_HEIGHT = 200;

function MessageImageTile(props: {
  item: MediaItem;
  large: boolean;
  onOpen: () => void;
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
      class="relative flex rounded-2xl"
      onClick={props.onOpen}
      aria-label="Open image viewer"
    >
      <MediaImage.Image
        src={props.item.src}
        class="max-h-[80vh] w-full select-none rounded-2xl border border-edge object-contain"
        width={dimensions()?.width ?? props.item.width ?? undefined}
        height={dimensions()?.height ?? props.item.height ?? undefined}
        fallback={<MediaImage.Fallback dims={dimensions()} />}
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

function AttachmentImageTile(props: { item: MediaItem; onOpen?: () => void }) {
  return (
    <MediaImage.Root>
      <MediaImage.Image
        src={props.item.src}
        class={cn(
          'size-23 select-none rounded-2xl border border-edge object-cover',
          props.onOpen && 'hover:opacity-80'
        )}
        onOpen={props.onOpen}
        width={ATTACHMENT_TILE_SIZE}
        height={ATTACHMENT_TILE_SIZE}
        loading="lazy"
        fallback={<MediaImage.Fallback square />}
      />
    </MediaImage.Root>
  );
}

function MessageVideoTile(props: { item: MediaItem; onOpen: () => void }) {
  const [isInlinePlaying, setIsInlinePlaying] = createSignal(false);
  const src = () => props.item.src;
  const videoWidth = () => props.item.width ?? undefined;
  const videoHeight = () => props.item.height ?? undefined;

  return (
    <div class="group relative flex min-h-20 max-h-120 max-w-120 min-w-0 overflow-hidden rounded-2xl border border-edge bg-surface">
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
        />
      </Show>
      <div class="absolute right-2 top-2 z-10">
        <Button
          variant="ghost"
          size="icon-md"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpen();
          }}
          label="Open video viewer"
        >
          <ExpandIcon />
        </Button>
      </div>
    </div>
  );
}

function AttachmentVideoTile(props: { item: MediaItem; onOpen?: () => void }) {
  return (
    <MediaVideo.Root class="size-23 group overflow-hidden border border-edge bg-surface">
      <MediaVideo.Preview
        src={props.item.src}
        class="size-full object-cover"
        onOpen={props.onOpen}
      />
      <MediaVideo.PlayOverlay onOpen={props.onOpen} />
    </MediaVideo.Root>
  );
}

export function MediaGrid(props: {
  items: MediaItem[];
  variant: 'message' | 'attachments';
  onOpen: (index: number) => void;
  class?: string;
}) {
  const hasSingleLargeImage = createMemo(
    () => props.items.length === 1 && props.items[0]?.kind === 'image'
  );

  return (
    <div
      class={cn(
        props.variant === 'attachments'
          ? 'flex flex-row flex-wrap gap-1.5'
          : 'flex flex-row flex-wrap gap-2',
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
              />
            </Match>
            <Match
              when={item.kind === 'image' && props.variant === 'attachments'}
            >
              <AttachmentImageTile
                item={item}
                onOpen={() => props.onOpen(index())}
              />
            </Match>
            <Match when={item.kind === 'video' && props.variant === 'message'}>
              <MessageVideoTile
                item={item}
                onOpen={() => props.onOpen(index())}
              />
            </Match>
            <Match when={true}>
              <AttachmentVideoTile
                item={item}
                onOpen={() => props.onOpen(index())}
              />
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
