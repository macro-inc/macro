import LoadingSpinner from '@phosphor/spinner.svg';
import { createSignal, Show } from 'solid-js';
import { createToolRenderer, useToolError } from './ToolRenderer';

function GeneratedImage(props: { url: string }) {
  const [failedUrl, setFailedUrl] = createSignal<string>();
  return (
    <Show
      when={failedUrl() !== props.url}
      fallback={
        <div role="status" class="text-sm text-ink-muted">
          Preview unavailable
        </div>
      }
    >
      <img
        src={props.url}
        alt="Generated image"
        class="my-2 block h-auto max-h-96 w-auto max-w-full rounded-xl"
        onError={() => setFailedUrl(props.url)}
      />
    </Show>
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
        {(result) => <GeneratedImage url={result().url} />}
      </Show>
    );
  },
});
