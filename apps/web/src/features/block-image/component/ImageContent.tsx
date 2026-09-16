import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';

export function ImageContent(props: { file: Blob; alt: string }) {
  const [imageUrl, setImageUrl] = createSignal<string>();

  createEffect(
    on(
      () => props.file,
      (file) => {
        const url = URL.createObjectURL(file);
        setImageUrl(url);
        onCleanup(() => URL.revokeObjectURL(url));
      }
    )
  );

  return (
    <Show
      when={imageUrl()}
      fallback={<div class="size-full" aria-label="Loading image" />}
    >
      {(url) => (
        <div class="flex size-full items-center justify-center">
          <img
            src={url()}
            alt={props.alt}
            class="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </Show>
  );
}
