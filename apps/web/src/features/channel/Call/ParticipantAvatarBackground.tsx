import { ENABLE_PROFILE_PICTURES } from '@core/constant/featureFlags';
import { staticFileSizedUrl } from '@core/constant/servers';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

/** Transparent pixels don't contribute to the visible picture's average. */
function averageAvatarColor(pixels: Uint8ClampedArray): string | undefined {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    red += pixels[i] * alpha;
    green += pixels[i + 1] * alpha;
    blue += pixels[i + 2] * alpha;
    weight += alpha;
  }
  if (!weight) return;
  return `rgb(${Math.round(red / weight)} ${Math.round(green / weight)} ${Math.round(blue / weight)})`;
}

export function ParticipantAvatarBackground(props: { userId: string }) {
  const [url] = useProfilePictureUrl(props.userId);
  const [color, setColor] = createSignal<string>();

  createEffect(
    on(url, (source) => {
      setColor(undefined);
      if (!ENABLE_PROFILE_PICTURES || !source) return;
      const image = new Image();
      const thumbnail = staticFileSizedUrl(source, 'small');
      let usingOriginal = thumbnail === source;
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 32;
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(image, 0, 0, 32, 32);
          setColor(averageAvatarColor(context.getImageData(0, 0, 32, 32).data));
        } catch {
          // Some external avatars disallow canvas reads; retain the panel color.
        }
      };
      image.onerror = () => {
        if (usingOriginal) return;
        usingOriginal = true;
        image.src = source;
      };
      image.src = thumbnail;
      onCleanup(() => {
        image.onload = null;
        image.onerror = null;
      });
    })
  );

  return (
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0"
      style={{
        background: color()
          ? `linear-gradient(135deg, color-mix(in srgb, ${color()} 24%, var(--color-panel)), color-mix(in srgb, ${color()} 8%, var(--color-panel)))`
          : undefined,
      }}
    />
  );
}
