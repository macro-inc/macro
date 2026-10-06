import { constrainImageDimensions } from '@macro-inc/lexical-core/utils/media';
import LoadingSpinner from '@phosphor/spinner.svg';
import { createSignal, Show } from 'solid-js';
import { createToolRenderer, useToolError } from './ToolRenderer';

function GeneratedImage(props: {
  url: string;
  width?: number | null;
  height?: number | null;
}) {
  const dimensions = () =>
    constrainImageDimensions(
      props.width ?? undefined,
      props.height ?? undefined,
      undefined,
      384
    );
  const [failedUrl, setFailedUrl] = createSignal<string>();
  return (
    <div
      class="relative my-2 max-w-full"
      style={{
        width: dimensions() ? `${dimensions()!.width}px` : undefined,
        'aspect-ratio': dimensions()
          ? `${dimensions()!.width} / ${dimensions()!.height}`
          : undefined,
      }}
    >
      <Show
        when={failedUrl() !== props.url}
        fallback={
          <div
            role="status"
            class="flex h-full items-center justify-center text-sm text-ink-muted"
          >
            Preview unavailable
          </div>
        }
      >
        <img
          src={props.url}
          alt="Generated image"
          width={dimensions()?.width}
          height={dimensions()?.height}
          class="block h-auto max-h-96 w-auto max-w-full rounded-xl"
          style={
            dimensions()
              ? { width: '100%', height: '100%', 'object-fit': 'contain' }
              : undefined
          }
          onError={() => setFailedUrl(props.url)}
        />
      </Show>
    </div>
  );
}

export const generateImageHandler = createToolRenderer({
  name: 'GenerateImage',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={ctx.response?.data}
        fallback={
          <div
            class="flex items-center gap-2 py-4 text-sm text-ink-muted"
            role="status"
          >
            <Show when={!error()} fallback="Image generation failed">
              <LoadingSpinner class="size-4 animate-spin" />
              <span>Generating image</span>
            </Show>
          </div>
        }
      >
        {(result) => (
          <GeneratedImage
            url={result().url}
            width={result().width}
            height={result().height}
          />
        )}
      </Show>
    );
  },
});
