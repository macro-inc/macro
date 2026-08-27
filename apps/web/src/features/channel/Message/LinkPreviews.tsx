import { isOwnMessage } from '@channel/Thread/utils/message-actions';
import { useUserId } from '@core/context/user';
import { useUnfurl } from '@core/signal/unfurl';
import { extractDomain, openExternalUrl } from '@core/util/url';
import GlobeIcon from '@phosphor/globe-simple.svg';
import XIcon from '@phosphor/x.svg';
import { useRemoveLinkPreviewMutation } from '@queries/channel/message';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { cn } from '@ui';
import { createEffect, createSignal, For, type JSX, Show } from 'solid-js';
import { useMessage } from './context';
import {
  hiddenUrlsForMessage,
  hideLinkPreview,
  isLinkPreviewHidden,
  showLinkPreviews,
  unhideLinkPreview,
} from './link-preview-visibility';
import { extractUnfurlableUrls, shouldRenderUnfurl } from './link-previews';

function openLink(url: string): JSX.EventHandler<HTMLElement, MouseEvent> {
  return (e) => {
    // Modified/middle clicks keep native anchor behavior (background tab
    // etc.); plain clicks go through openExternalUrl so links open in the
    // system browser under Tauri.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openExternalUrl(url);
  };
}

function LinkPreviewCard(props: {
  unfurled: GetUnfurlResponse;
  onHide?: () => void;
}) {
  const [faviconFailed, setFaviconFailed] = createSignal(false);
  const [imageFailed, setImageFailed] = createSignal(false);
  const domain = () => extractDomain(props.unfurled.url);

  return (
    <div
      class="mb-2 flex min-w-0 flex-col gap-0.5 border-l-2 border-edge py-0.5 pl-3"
      data-link-preview={props.unfurled.url}
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <Show
          when={props.unfurled.favicon_url && !faviconFailed()}
          fallback={<GlobeIcon class="size-3.5 shrink-0 text-ink-muted" />}
        >
          {(_) => (
            <img
              src={proxyResource(props.unfurled.favicon_url!)}
              class="size-3.5 shrink-0 rounded-xs object-cover"
              crossorigin="anonymous"
              alt=""
              draggable={false}
              on:error={() => setFaviconFailed(true)}
            />
          )}
        </Show>
        <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {domain()}
        </span>
        <Show when={props.onHide}>
          <button
            type="button"
            aria-label="Remove link preview"
            class="flex size-6 shrink-0 items-center justify-center rounded-md border border-edge-muted bg-surface text-ink hover:bg-hover"
            onClick={props.onHide}
          >
            <XIcon class="size-3.5" />
          </button>
        </Show>
      </div>
      <a
        href={props.unfurled.url}
        target="_blank"
        rel="noopener"
        class="line-clamp-2 wrap-break-word text-sm font-medium text-accent hover:underline"
        draggable={false}
        onClick={openLink(props.unfurled.url)}
      >
        {props.unfurled.title || domain()}
      </a>
      <Show when={props.unfurled.description}>
        <p class="line-clamp-3 wrap-break-word text-xs text-ink-muted">
          {props.unfurled.description}
        </p>
      </Show>
      <Show when={props.unfurled.image_url && !imageFailed()}>
        {(_) => (
          <a
            href={props.unfurled.url}
            target="_blank"
            rel="noopener"
            class="mt-1 self-start"
            draggable={false}
            onClick={openLink(props.unfurled.url)}
          >
            <img
              src={proxyResource(props.unfurled.image_url!)}
              class="max-h-64 w-auto max-w-full rounded-md border border-edge-muted"
              crossorigin="anonymous"
              alt={props.unfurled.title}
              draggable={false}
              on:error={() => setImageFailed(true)}
            />
          </a>
        )}
      </Show>
    </div>
  );
}

function LinkPreview(props: {
  url: string;
  onRemove: (() => void) | undefined;
}) {
  const [unfurlData] = useUnfurl(props.url);
  const renderable = () => {
    const data = unfurlData();
    if (data?.type !== 'success') return undefined;
    return shouldRenderUnfurl(data.data) ? data.data : undefined;
  };

  return (
    <Show when={renderable()}>
      {(unfurled) => (
        <LinkPreviewCard unfurled={unfurled()} onHide={props.onRemove} />
      )}
    </Show>
  );
}

type LinkPreviewsProps = {
  /** Enables the sender's "remove preview" action on this message's cards. */
  channelId?: string;
  class?: string;
};

/**
 * Slack-style rich previews for external links in the message body, rendered
 * below the content. Previews pop in once the unfurl service responds; links
 * with no usable metadata, and links whose sender removed the preview
 * (`preview: false` on the link node), render nothing.
 */
export function LinkPreviews(props: LinkPreviewsProps) {
  const message = useMessage();
  const userId = useUserId();
  const removePreview = useRemoveLinkPreviewMutation();
  // Extraction already drops `preview: false` links; the local hidden set is
  // the optimistic layer covering the gap until rewritten content arrives.
  const previewable = () =>
    message().deleted_at ? [] : extractUnfurlableUrls(message().content ?? '');
  const urls = () =>
    showLinkPreviews()
      ? previewable().filter((url) => !isLinkPreviewHidden(message().id, url))
      : [];

  // Sender-only, per link: the server sets `preview: false` on the matching
  // link node, hiding the card for every participant.
  const removeForEveryone = (url: string) => {
    const messageId = message().id;
    const channelId = props.channelId;
    if (!channelId) return;
    hideLinkPreview(messageId, url);
    removePreview.mutate(
      { channelID: channelId, messageID: messageId, url },
      { onError: () => unhideLinkPreview(messageId, url) }
    );
  };
  const canRemove = () =>
    props.channelId !== undefined && isOwnMessage(message(), userId());

  // Once the rewritten content lands in the cache, extraction no longer
  // yields the URL and the optimistic entry is redundant — drop it so it
  // cannot shadow a future re-enable of the preview.
  createEffect(() => {
    const id = message().id;
    const live = new Set(previewable());
    for (const url of hiddenUrlsForMessage(id)) {
      if (!live.has(url)) unhideLinkPreview(id, url);
    }
  });

  return (
    <Show when={urls().length > 0}>
      {/* Spacing lives on the cards: with every unfurl still loading or
          failed this container is empty and must take up no height. */}
      <div
        class={cn('flex min-w-0 max-w-md flex-col', props.class)}
        data-message-link-previews
      >
        <For each={urls()}>
          {(url) => (
            <LinkPreview
              url={url}
              onRemove={canRemove() ? () => removeForEveryone(url) : undefined}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
