import { staticFileIdEndpoint } from '@core/constant/servers';
import ExpandIcon from '@icon/regular/arrows-out-simple.svg';
import PlayIcon from '@icon/fill/play-fill.svg';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { constrainImageDimensions } from '@lexical-core/utils/media';
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { MediaItem } from './media-items';

const ATTACHMENT_TILE_SIZE = 92;
const SINGLE_IMAGE_MAX_WIDTH = 400;
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
      props.large ? undefined : MESSAGE_GALLERY_IMAGE_MAX_HEIGHT
    );

  return (
    <button
      type="button"
      class="relative flex rounded-2xl"
      onClick={props.onOpen}
      aria-label="Open image viewer"
    >
      <img
        class="max-h-[80vh] w-full select-none rounded-2xl border border-edge object-contain"
        src={staticFileIdEndpoint(props.item.entityId)}
        alt="preview"
        width={dimensions()?.width ?? props.item.width ?? undefined}
        height={dimensions()?.height ?? props.item.height ?? undefined}
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

function AttachmentImageTile(props: { item: MediaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      class="flex rounded-2xl"
      onClick={props.onOpen}
      aria-label="Open image viewer"
    >
      <img
        class="size-23 cursor-pointer select-none rounded-2xl border border-edge object-cover hover:opacity-80"
        src={staticFileIdEndpoint(props.item.entityId)}
        alt="preview"
        width={ATTACHMENT_TILE_SIZE}
        height={ATTACHMENT_TILE_SIZE}
        loading="lazy"
      />
    </button>
  );
}

function MessageVideoTile(props: { item: MediaItem; onOpen: () => void }) {
  const [isInlinePlaying, setIsInlinePlaying] = createSignal(false);
  const src = () => staticFileIdEndpoint(props.item.entityId);

  return (
    <div
      class={cn(
        'group relative min-h-20 min-w-0 overflow-hidden rounded-2xl border border-edge bg-menu',
        isInlinePlaying() ? 'w-full max-w-[400px]' : 'w-full max-w-[400px]'
      )}
    >
      <Show
        when={isInlinePlaying()}
        fallback={
          <>
            <button
              type="button"
              class="block w-full cursor-pointer"
              onClick={props.onOpen}
              aria-label="Open video viewer"
            >
              <video
                class="block max-h-[500px] max-w-full"
                preload="metadata"
                playsinline
                muted
                src={src()}
              />
              <div class="absolute inset-0 flex items-center justify-center bg-ink/20 transition-colors group-hover:bg-ink/30">
                <PlayIcon class="size-6 text-page drop-shadow" />
              </div>
            </button>
            <button
              type="button"
              class="absolute bottom-2 left-2 rounded-md bg-dialog/90 px-2 py-1 text-xs font-medium text-ink shadow-sm"
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
          class="block max-h-[500px] max-w-full"
          controls
          autoplay
          playsinline
          src={src()}
        />
      </Show>
      <div class="absolute right-2 top-2 z-10">
        <DeprecatedIconButton
          icon={ExpandIcon}
          theme="clear"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpen();
          }}
          tooltip={{ label: 'Open video viewer' }}
        />
      </div>
    </div>
  );
}

function AttachmentVideoTile(props: { item: MediaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      class="size-23 group relative overflow-hidden rounded-2xl border border-edge bg-menu"
      onClick={props.onOpen}
      aria-label="Open video viewer"
    >
      <video
        class="size-full object-cover"
        preload="metadata"
        playsinline
        muted
        src={staticFileIdEndpoint(props.item.entityId)}
      />
      <div class="absolute inset-0 flex items-center justify-center bg-ink/20 transition-colors group-hover:bg-ink/30">
        <PlayIcon class="size-5 text-page drop-shadow" />
      </div>
    </button>
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
