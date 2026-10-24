import type { MediaItem } from '@channel/Media/media-items';
import { MediaPreview } from '@channel/Message/MediaPreview';
import { constrainImageDimensions } from '@macro-inc/lexical-core/utils/media';
import MicrophoneIcon from '@phosphor/microphone.svg';
import { For, Match, Show, Switch } from 'solid-js';
import { formatDuration } from '../core/rich';

/** An imported image, video or voice note with its resolved file URL. */
export type InboundMediaFile = {
  id: string;
  kind: 'image' | 'video' | 'audio';
  fileName: string;
  /** Undefined while the URL resolves. */
  url: string | undefined;
  /** Declared by WhatsApp; reserves the space before the file loads. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  presentation?: 'sticker' | 'gif' | 'voice_note';
};

/** Chat's single-image bound, so a GIF sits like a photo would. */
const MEDIA_MAX = 400;
const STICKER_MAX = 144;

function boxFor(file: InboundMediaFile, max: number) {
  return (
    constrainImageDimensions(file.width, file.height, max, max) ?? {
      width: max,
      height: max,
    }
  );
}

/** Placeholder the size the file will be, so the timeline doesn't jump. */
function Reserved(props: { file: InboundMediaFile; max: number }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${props.file.fileName}`}
      class="max-w-full skeleton-shimmer rounded-2xl bg-skeleton"
      style={{
        width: `${boxFor(props.file, props.max).width}px`,
        'aspect-ratio': `${boxFor(props.file, props.max).width} / ${boxFor(props.file, props.max).height}`,
      }}
    />
  );
}

/** Sticker size, no frame, like WhatsApp. */
function Sticker(props: { file: InboundMediaFile }) {
  return (
    <Show
      when={props.file.url}
      fallback={<Reserved file={props.file} max={STICKER_MAX} />}
    >
      {(url) => (
        <img
          src={url()}
          alt="Sticker"
          data-whatsapp-sticker
          width={boxFor(props.file, STICKER_MAX).width}
          height={boxFor(props.file, STICKER_MAX).height}
          class="max-w-full object-contain select-none"
          loading="lazy"
        />
      )}
    </Show>
  );
}

/** A GIF loops silently in place, like Chat's inline GIFs. */
function Gif(props: { file: InboundMediaFile }) {
  return (
    <Show
      when={props.file.url}
      fallback={<Reserved file={props.file} max={MEDIA_MAX} />}
    >
      {(url) => (
        <video
          src={url()}
          aria-label="GIF"
          data-whatsapp-gif
          autoplay
          loop
          muted
          playsinline
          // Browsers autoplay only muted video; the attribute alone doesn't
          // mute an element created by script.
          ref={(video) => {
            video.muted = true;
          }}
          width={boxFor(props.file, MEDIA_MAX).width}
          height={boxFor(props.file, MEDIA_MAX).height}
          class="block h-auto max-w-full rounded-2xl border border-edge bg-surface"
        />
      )}
    </Show>
  );
}

function Audio(props: { file: InboundMediaFile }) {
  const voice = () => props.file.presentation === 'voice_note';
  const label = () =>
    [
      voice() ? 'Voice note' : props.file.fileName,
      props.file.durationSeconds
        ? formatDuration(props.file.durationSeconds)
        : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <div class="flex w-72 max-w-full flex-col gap-1">
      <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
        <Show when={voice()}>
          <MicrophoneIcon class="size-3.5 shrink-0" aria-hidden="true" />
        </Show>
        <span class="truncate" data-whatsapp-audio-label>
          {label()}
        </span>
      </span>
      <Show
        when={props.file.url}
        fallback={
          <div
            role="status"
            aria-label={`Loading ${props.file.fileName}`}
            class="h-10 w-full skeleton-shimmer rounded-full bg-skeleton"
          />
        }
      >
        {(url) => (
          <audio
            controls
            preload="metadata"
            src={url()}
            aria-label={label()}
            class="h-10 w-full"
          />
        )}
      </Show>
    </div>
  );
}

/**
 * WhatsApp media inline, like Chat: images and video in Chat's media grid
 * (click opens the viewer), GIFs looping, stickers small and unframed,
 * audio and voice notes in a player with their length.
 */
export function InboundMedia(props: { files: InboundMediaFile[] }) {
  const grid = () =>
    props.files.filter(
      (file) =>
        file.kind !== 'audio' &&
        file.presentation !== 'sticker' &&
        file.presentation !== 'gif'
    );
  const visual = (): MediaItem[] =>
    grid().flatMap((file) =>
      file.url && file.kind !== 'audio'
        ? [
            {
              id: file.id,
              src: file.url,
              fullSrc: file.url,
              kind: file.kind,
              width: file.width,
              height: file.height,
            },
          ]
        : []
    );
  return (
    <div class="mt-1 flex flex-col gap-2" data-whatsapp-inline-media>
      <Show when={visual().length > 0}>
        <MediaPreview items={visual()} />
      </Show>
      <For each={grid().filter((file) => !file.url)}>
        {(file) => <Reserved file={file} max={MEDIA_MAX} />}
      </For>
      <For each={props.files}>
        {(file) => (
          <Switch>
            <Match when={file.kind === 'audio'}>
              <Audio file={file} />
            </Match>
            <Match when={file.presentation === 'sticker'}>
              <Sticker file={file} />
            </Match>
            <Match when={file.presentation === 'gif'}>
              <Gif file={file} />
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
