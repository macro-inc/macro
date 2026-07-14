import type { Track } from 'livekit-client';
import { createEffect, on, onCleanup } from 'solid-js';

/**
 * Generic track view that attaches/detaches a LiveKit track's media element.
 * Callers resolve the track; this component handles the DOM lifecycle.
 */
export function TrackView(props: {
  track: Track | undefined;
  fit?: 'cover' | 'contain';
  mirror?: boolean;
}) {
  let ref!: HTMLDivElement;
  let attachedTrack: Track | undefined;
  let attachedElement: Element | undefined;

  createEffect(
    on(
      () => props.track,
      (track, prev) => {
        if (prev === track) return;

        prev?.detach().forEach((el) => el.remove());
        attachedTrack = undefined;
        attachedElement = undefined;

        if (!track) return;

        const el = track.attach();
        attachedTrack = track;
        attachedElement = el;
        Object.assign(el.style, {
          width: '100%',
          height: '100%',
          objectFit: props.fit ?? 'cover',
          transform: props.mirror ? 'scaleX(-1)' : '',
        });
        ref.appendChild(el);
      }
    )
  );

  onCleanup(() => {
    if (attachedTrack) {
      attachedTrack.detach().forEach((el) => el.remove());
    } else {
      attachedElement?.remove();
    }
  });

  return <div ref={ref} class="size-full" />;
}
