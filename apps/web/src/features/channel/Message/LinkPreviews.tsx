import { LinkPreviewCard } from '@core/component/Link';
import { useUnfurl } from '@core/signal/unfurl';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { For, Show } from 'solid-js';

/** A page that told us nothing beyond its address gets no card. */
function hasPreviewContent(unfurled: GetUnfurlResponse): boolean {
  if (unfurled.title !== '' && unfurled.title !== unfurled.url) return true;
  return Boolean(unfurled.description || unfurled.image_url);
}

function LinkPreview(props: { url: string }) {
  // The link in the text fetched this for its hover card, so this adds no request.
  const [unfurl] = useUnfurl(props.url);
  const preview = () => {
    const result = unfurl();
    if (result?.type !== 'success') return;
    if (!hasPreviewContent(result.data)) return;
    return result.data;
  };

  return (
    <Show when={preview()}>
      {(unfurled) => (
        <div class="mt-2">
          <LinkPreviewCard unfurled={unfurled()} />
        </div>
      )}
    </Show>
  );
}

/**
 * Previews of the web pages a message links to, as cards beneath its text.
 * Links stay in the text; a link whose page can't be read shows no card.
 */
export function LinkPreviews(props: { urls: string[] }) {
  return (
    <Show when={props.urls.length > 0}>
      <div data-message-link-previews>
        <For each={props.urls}>{(url) => <LinkPreview url={url} />}</For>
      </div>
    </Show>
  );
}
