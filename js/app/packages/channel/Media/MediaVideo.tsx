import PlayIcon from '@icon/fill/play-fill.svg';
import { cn } from '@ui/utils/classname';
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
    />
  );
}

function PlayOverlay(props: { onOpen?: () => void; class?: string }) {
  return (
    <div
      class={cn(
        'absolute inset-0 flex items-center justify-center bg-ink/20',
        props.onOpen &&
          'cursor-pointer transition-colors group-hover:bg-ink/30',
        props.class
      )}
      onClick={() => props.onOpen?.()}
    >
      <PlayIcon class="size-5 text-page drop-shadow" />
    </div>
  );
}

export const MediaVideo = {
  Root,
  Preview,
  PlayOverlay,
};
