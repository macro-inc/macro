import type { MediaItem } from '@channel/Media/media-items';
import { MediaPreview } from '@channel/Message/MediaPreview';
import { For, Show } from 'solid-js';

/** An imported image, video or voice note with its resolved file URL. */
export type InboundMediaFile = {
  id: string;
  kind: 'image' | 'video' | 'audio';
  fileName: string;
  /** Undefined while the URL resolves. */
  url: string | undefined;
};

/**
 * WhatsApp media inline, like Chat: images and video in Chat's media grid
 * (click opens the viewer), audio in a player.
 */
export function InboundMedia(props: { files: InboundMediaFile[] }) {
  const visual = (): MediaItem[] =>
    props.files.flatMap((file) =>
      file.kind !== 'audio' && file.url
        ? [{ id: file.id, src: file.url, fullSrc: file.url, kind: file.kind }]
        : []
    );
  const loading = () =>
    props.files.some((file) => file.kind !== 'audio' && !file.url);
  return (
    <div class="mt-1 flex flex-col gap-2" data-whatsapp-inline-media>
      <Show when={visual().length > 0}>
        <MediaPreview items={visual()} />
      </Show>
      <Show when={loading()}>
        <div
          role="status"
          aria-label="Loading media"
          class="h-48 w-64 max-w-full skeleton-shimmer rounded-2xl bg-skeleton"
        />
      </Show>
      <For each={props.files.filter((file) => file.kind === 'audio')}>
        {(file) => (
          <Show
            when={file.url}
            fallback={
              <div
                role="status"
                aria-label={`Loading ${file.fileName}`}
                class="h-10 w-72 max-w-full skeleton-shimmer rounded-full bg-skeleton"
              />
            }
          >
            {(url) => (
              <audio
                controls
                preload="metadata"
                src={url()}
                aria-label={file.fileName}
                class="h-10 w-72 max-w-full"
              />
            )}
          </Show>
        )}
      </For>
    </div>
  );
}
