import type { MediaItem } from '@channel/Media/media-items';
import { MediaPreview } from '@channel/Message/MediaPreview';
import { staticFileSizedUrl } from '@core/constant/servers';
import { constrainImageDimensions } from '@macro-inc/lexical-core/utils/media';
import MicrophoneIcon from '@phosphor/microphone.svg';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { formatDuration } from '../core/rich';
import { InboundAttachmentPlaceholder } from './inbound-attachment';

/** A stored image, video or voice note with its static file URL. */
export type InboundMediaFile = {
  id: string;
  kind: 'image' | 'video' | 'audio';
  fileName: string;
  /** The stored file, else the local preview of a file this page sent. */
  url: string | undefined;
  /** A local preview shown until `url` loads (files this page sent). */
  previewUrl?: string;
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
function Sticker(props: { file: InboundMediaFile; onError: () => void }) {
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
          onError={() => props.onError()}
        />
      )}
    </Show>
  );
}

/** A GIF loops silently in place, like Chat's inline GIFs. */
function Gif(props: { file: InboundMediaFile; onError: () => void }) {
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
          onError={() => props.onError()}
        />
      )}
    </Show>
  );
}

function Audio(props: { file: InboundMediaFile; onError: () => void }) {
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
            onError={() => props.onError()}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * WhatsApp media inline, like Chat: images and video in Chat's media grid
 * (click opens the viewer), GIFs looping, stickers small and unframed,
 * audio and voice notes in a player with their length. A file that can't be
 * fetched shows as unavailable instead of loading forever.
 */
export function InboundMedia(props: { files: InboundMediaFile[] }) {
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());
  const fail = (id: string) => setFailed((ids) => new Set(ids).add(id));
  const usable = (file: InboundMediaFile) => !failed().has(file.id);
  const grid = () =>
    props.files.filter(
      (file) =>
        usable(file) &&
        file.kind !== 'audio' &&
        file.presentation !== 'sticker' &&
        file.presentation !== 'gif'
    );
  // Like Chat's `mapMediaItems`: an unchanged file keeps its item, so the
  // grid doesn't remount (and reload) it.
  const visual = createMemo(
    (previous: MediaItem[]) =>
      grid().flatMap((file): MediaItem[] => {
        if (!file.url || file.kind === 'audio') return [];
        // Sized like Chat's static images (a local preview stays as is).
        const item: MediaItem = {
          id: file.id,
          src:
            file.kind === 'image'
              ? staticFileSizedUrl(file.url, 'medium')
              : file.url,
          thumbSrc:
            file.kind === 'image'
              ? staticFileSizedUrl(file.url, 'small')
              : undefined,
          fullSrc: file.url,
          previewSrc: file.previewUrl,
          kind: file.kind,
          width: file.width,
          height: file.height,
        };
        const kept = previous.find((old) => old.id === item.id);
        return [
          kept &&
          (Object.keys(item) as (keyof MediaItem)[]).every(
            (key) => kept[key] === item[key]
          )
            ? kept
            : item,
        ];
      }),
    []
  );
  return (
    <div class="mt-1 flex flex-col gap-2" data-whatsapp-inline-media>
      <Show when={visual().length > 0}>
        <MediaPreview items={visual()} onError={fail} />
      </Show>
      <For each={grid().filter((file) => !file.url)}>
        {(file) => <Reserved file={file} max={MEDIA_MAX} />}
      </For>
      <For each={props.files}>
        {(file) => (
          <Switch>
            <Match when={!usable(file)}>
              <InboundAttachmentPlaceholder
                state="unavailable"
                fileName={file.fileName}
              />
            </Match>
            <Match when={file.kind === 'audio'}>
              <Audio file={file} onError={() => fail(file.id)} />
            </Match>
            <Match when={file.presentation === 'sticker'}>
              <Sticker file={file} onError={() => fail(file.id)} />
            </Match>
            <Match when={file.presentation === 'gif'}>
              <Gif file={file} onError={() => fail(file.id)} />
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
