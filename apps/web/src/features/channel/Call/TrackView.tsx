import type { Track } from 'livekit-client';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

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
  const [attachedElement, setAttachedElement] =
    createSignal<HTMLMediaElement>();

  createEffect(
    on(
      () => props.track,
      (track, prev) => {
        if (prev === track) return;

        const previousElement = attachedElement();
        if (prev && previousElement) {
          prev.detach(previousElement);
          previousElement.remove();
        }
        attachedTrack = undefined;
        setAttachedElement(undefined);

        if (!track) return;

        const el = track.attach();
        attachedTrack = track;
        setAttachedElement(el);
        ref.appendChild(el);
      }
    )
  );

  createEffect(
    on(
      () => [attachedElement(), props.fit, props.mirror] as const,
      ([element, fit, mirror]) => {
        if (!element) return;
        Object.assign(element.style, {
          width: '100%',
          height: '100%',
          objectFit: fit ?? 'cover',
          transform: mirror ? 'scaleX(-1)' : '',
        });
      }
    )
  );

  onCleanup(() => {
    const element = attachedElement();
    if (attachedTrack && element) attachedTrack.detach(element);
    element?.remove();
  });

  return <div ref={ref} class="size-full" />;
}
