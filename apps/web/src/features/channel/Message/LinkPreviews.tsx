import { LinkPreviewCard } from '@core/component/Link';
import type { LinkPreview } from '@service-storage/messages';
import { For, Show } from 'solid-js';

/**
 * Previews of the web pages a message links to, as cards beneath its text.
 * They come with the message, so the cards are there when it first renders.
 */
export function LinkPreviews(props: { previews: LinkPreview[] }) {
  return (
    <Show when={props.previews.length > 0}>
      <div data-message-link-previews>
        <For each={props.previews}>
          {(preview) => (
            <div class="mt-2">
              <LinkPreviewCard preview={preview} />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
