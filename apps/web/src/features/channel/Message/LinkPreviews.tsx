import { isOwnMessage } from '@channel/Thread/utils/message-actions';
import {
  enableRichLinkPreviews,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useUnfurl } from '@core/signal/unfurl';
import { extractDomain, openExternalUrl } from '@core/util/url';
import GlobeIcon from '@phosphor/globe-simple.svg';
import XIcon from '@phosphor/x.svg';
import { useRemoveLinkPreviewMutation } from '@queries/messages/mutations';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
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
  url: string;
  unfurled?: GetUnfurlResponse;
  loading?: boolean;
  onHide?: () => void;
}) {
  const [faviconFailed, setFaviconFailed] = createSignal(false);
  const [imageFailed, setImageFailed] = createSignal(false);
  const domain = () => extractDomain(props.url);

  return (
    <div
      class="group/preview relative mb-2 flex h-32 min-w-0 shrink-0 flex-col gap-0.5 overflow-hidden border-l-2 border-edge py-0.5 pl-3"
      data-link-preview={props.url}
      aria-busy={props.loading ?? false}
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <Show
          when={!faviconFailed() ? props.unfurled?.favicon_url : undefined}
          fallback={<GlobeIcon class="size-3.5 shrink-0 text-ink-muted" />}
        >
          {(faviconUrl) => (
            <img
              src={proxyResource(faviconUrl())}
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
            class="shrink-0 rounded p-0.5 text-ink-extra-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover/preview:opacity-100 touch:opacity-100"
            onClick={props.onHide}
          >
            <XIcon class="size-3.5" />
          </button>
        </Show>
      </div>
      <div class="flex min-h-0 flex-1 gap-3">
        <div class="min-w-0 flex-1 overflow-hidden">
          <a
            href={props.url}
            target="_blank"
            rel="noopener"
            class="line-clamp-2 wrap-break-word text-sm leading-5 font-medium text-accent hover:underline"
            draggable={false}
            onClick={openLink(props.url)}
          >
            {props.unfurled?.title || props.url}
          </a>
          <Show when={props.unfurled?.description}>
            <p class="m-0 line-clamp-3 wrap-break-word text-xs leading-4 text-ink-muted">
              {props.unfurled?.description}
            </p>
          </Show>
        </div>
        <Show when={!imageFailed() ? props.unfurled?.image_url : undefined}>
          {(imageUrl) => (
            <a
              href={props.url}
              target="_blank"
              rel="noopener"
              class="size-20 shrink-0 overflow-hidden rounded-md border border-edge-muted"
              aria-label={props.unfurled?.title || props.url}
              onClick={openLink(props.url)}
            >
              <img
                src={proxyResource(imageUrl())}
                class="size-full object-cover"
                width={80}
                height={80}
                crossorigin="anonymous"
                alt=""
                draggable={false}
                on:error={() => setImageFailed(true)}
              />
            </a>
          )}
        </Show>
      </div>
    </div>
  );
}

function LinkPreview(props: {
  url: string;
  onRemove: (() => void) | undefined;
}) {
  const [unfurlData] = useUnfurl(props.url);
  const renderable = createMemo(() => {
    const data = unfurlData();
    if (data?.type !== 'success') return undefined;
    return shouldRenderUnfurl(data.data) ? data.data : undefined;
  });

  return (
    <LinkPreviewCard
      url={props.url}
      unfurled={renderable()}
      loading={!unfurlData() || unfurlData()?.type === 'loading'}
      onHide={props.onRemove}
    />
  );
}

type LinkPreviewsProps = {
  /** Enables the sender's "remove preview" action on this message's cards. */
  channelId?: string;
  class?: string;
};

/**
 * Slack-style rich previews for external links in the message body, rendered
 * below the content. Every eligible URL reserves its final height immediately.
 * Missing metadata keeps a useful URL card, so enrichment and image failures
 * never resize the message. Explicitly suppressed links render nothing.
 */
export function LinkPreviews(props: LinkPreviewsProps) {
  // Keep rollout eligibility stable for this mount: a late PostHog response
  // must not insert cards after the channel has measured the message.
  const previewsEnabled = isFeatureEnabled(enableRichLinkPreviews);
  const message = useMessage();
  const userId = useUserId();
  const removePreview = useRemoveLinkPreviewMutation({
    // Mutation-level callbacks run for every request, even when another
    // removal replaces the observer's per-call callbacks.
    onError: (_error, { messageID, url }) => unhideLinkPreview(messageID, url),
  });
  // Extraction already drops `preview: false` links; the local hidden set is
  // the optimistic layer covering the gap until rewritten content arrives.
  const previewable = createMemo(() =>
    message().deleted_at ? [] : extractUnfurlableUrls(message().content ?? '')
  );
  const urls = createMemo(() =>
    previewsEnabled && showLinkPreviews()
      ? previewable().filter((url) => !isLinkPreviewHidden(message().id, url))
      : []
  );

  // Sender-only, per link: the server sets `preview: false` on the matching
  // link node, hiding the card for every participant.
  const removeForEveryone = (url: string) => {
    const messageId = message().id;
    const channelId = props.channelId;
    if (!channelId) return;
    hideLinkPreview(messageId, url);
    removePreview.mutate({ channelID: channelId, messageID: messageId, url });
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
      {/* URL extraction is synchronous; card count and height are known
          before the channel virtualizer measures the message. */}
      <div
        class={cn('flex min-w-0 max-w-md flex-col', props.class)}
        data-message-link-previews
      >
        <For each={urls()}>
          {(url) => (
            <Suspense
              fallback={
                <LinkPreviewCard
                  url={url}
                  loading
                  onHide={
                    canRemove() ? () => removeForEveryone(url) : undefined
                  }
                />
              }
            >
              <LinkPreview
                url={url}
                onRemove={
                  canRemove() ? () => removeForEveryone(url) : undefined
                }
              />
            </Suspense>
          )}
        </For>
      </div>
    </Show>
  );
}
