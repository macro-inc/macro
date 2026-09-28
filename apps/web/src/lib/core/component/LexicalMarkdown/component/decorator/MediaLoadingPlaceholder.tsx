/**
 * Reserved card while a markdown image or video is still fetching.
 *
 * Artifact markdown (cloud-agent screenshots and recordings) arrives without
 * width/height, so the media node itself has no box. Without this placeholder
 * the loading spinner sits in a zero-height overlay and a run of files
 * collapses to a stack of dots.
 */

import VideoIcon from '@phosphor/file-video.svg';
import ImageIcon from '@phosphor/image.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';

export function MediaLoadingPlaceholder(props: {
  kind: 'image' | 'video';
  /** File name from the image alt text, or the last path segment of a video. */
  label?: string;
}) {
  const caption = () => {
    const label = props.label?.trim();
    if (label) return label;
    return props.kind === 'video' ? 'Video' : 'Image';
  };

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Loading ${caption()}`}
      data-media-loading={props.kind}
      class={cn(
        'relative w-full max-w-[640px] aspect-video overflow-hidden',
        'rounded-xl border border-edge bg-skeleton skeleton-shimmer'
      )}
    >
      <div class="absolute inset-0 flex items-center justify-center text-ink-extra-muted">
        <LoadingSpinner class="size-5 animate-spin" />
      </div>
      <div class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-surface/80 px-3 py-2 text-xs text-ink-muted">
        <Show
          when={props.kind === 'video'}
          fallback={<ImageIcon class="size-3.5 shrink-0" />}
        >
          <VideoIcon class="size-3.5 shrink-0" />
        </Show>
        <span class="truncate">{caption()}</span>
      </div>
    </div>
  );
}

/** Last path segment when it looks like a file name, otherwise undefined. */
export function mediaFileNameFromUrl(url: string): string | undefined {
  try {
    const last = new URL(url, 'https://macro.invalid').pathname
      .split('/')
      .filter(Boolean)
      .at(-1);
    if (!last) return undefined;
    const decoded = decodeURIComponent(last);
    return decoded.includes('.') ? decoded : undefined;
  } catch {
    return undefined;
  }
}
