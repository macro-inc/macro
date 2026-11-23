import { cn } from '@ui';

/** A voice memo's native player: keyboard, screen reader and touch ready. */
export function VoiceMemoPlayer(props: {
  src: string;
  /** Names the player for screen readers. */
  label: string;
  class?: string;
}) {
  return (
    <audio
      class={cn('h-9 w-64 max-w-full', props.class)}
      src={props.src}
      controls
      preload="metadata"
      aria-label={props.label}
      data-voice-memo-player
    />
  );
}
