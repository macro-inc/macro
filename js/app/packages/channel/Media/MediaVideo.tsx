import PlayIcon from '@phosphor/play.svg';
import { cn } from '@ui';
import type { ParentProps } from 'solid-js';

function Root(props: ParentProps<{ class?: string }>) {
  return (
    <div class={cn('relative flex rounded-2xl', props.class)}>
      {props.children}
    </div>
  );
}

function Preview(props: {
  src: string;
  class?: string;
  onOpen?: () => void;
  width?: number;
  height?: number;
}) {
  return (
    <video
      class={props.class}
      preload="metadata"
      playsinline
      muted
      src={props.src}
      width={props.width}
      height={props.height}
      onClick={() => props.onOpen?.()}
      onLoadedMetadata={(e) => {
        // iOS Safari doesn't paint the first frame with preload="metadata".
        // Seeking to a tiny positive time forces it to decode and display the frame.
        e.currentTarget.currentTime = 0.001;
      }}
    />
  );
}

function PlayOverlay(props: { onOpen?: () => void; class?: string }) {
  return (
    <div
      class={cn(
        'absolute inset-0 flex items-center justify-center bg-ink/20',
        props.onOpen && 'transition-colors group-hover:bg-ink/30',
        props.class
      )}
      onClick={() => props.onOpen?.()}
    >
      <PlayIcon class="size-5 text-surface drop-shadow" />
    </div>
  );
}

export const MediaVideo = {
  Root,
  Preview,
  PlayOverlay,
};
