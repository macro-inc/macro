import { MediaImage } from '@channel/Media/MediaImage';
import { isOwnMessage } from '@channel/Thread/utils/message-actions';
import { useUserId } from '@core/context/user';
import { useUnfurl } from '@core/signal/unfurl';
import { extractDomain, openExternalUrl } from '@core/util/url';
import GlobeIcon from '@phosphor/globe-simple.svg';
import XIcon from '@phosphor/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { useRemoveLinkPreviewMutation } from '@queries/channel/message';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { useMessage } from './context';
import {
  hiddenUrlsForMessage,
  hideLinkPreview,
  isLinkPreviewHidden,
  showLinkPreviews,
  unhideLinkPreview,
} from './link-preview-visibility';
import {
  extractUnfurlableUrls,
  LINK_PREVIEW_CHROME_HEIGHT,
  LINK_PREVIEW_IMAGE_HEIGHT,
  LINK_PREVIEW_IMAGE_WIDTH,
  LINK_PREVIEW_SLOT_HEIGHT,
  linkPreviewSlotState,
  reservedPreviewImageSize,
} from './link-previews';

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

function RemovePreviewButton(props: { onHide: () => void; hovered: boolean }) {
  return (
    <button
      type="button"
      aria-label="Remove link preview"
      class={cn(
        'shrink-0 rounded p-0.5 text-ink-muted',
        props.hovered
          ? 'opacity-100'
          : 'opacity-0 group-hover/message:opacity-100 group-hover/preview:opacity-100 group-focus-within/message:opacity-100 group-focus-within/preview:opacity-100 focus-visible:opacity-100 touch:opacity-100'
      )}
      onClick={props.onHide}
    >
      <XIcon class="size-4 fill-current" />
    </button>
  );
}

function PreviewSlot(props: { url: string; children: JSX.Element }) {
  return (
    <div
      class="mb-2 box-border flex min-w-0 max-w-md flex-col gap-1 overflow-hidden"
      style={{ height: `${LINK_PREVIEW_SLOT_HEIGHT}px` }}
      data-link-preview-slot={props.url}
    >
      {props.children}
    </div>
  );
}

function PreviewImageFrame(props: { src?: string; objectContain?: boolean }) {
  return (
    <div
      class="shrink-0 self-start overflow-hidden rounded-md"
      style={{
        width: `${LINK_PREVIEW_IMAGE_WIDTH}px`,
        height: `${LINK_PREVIEW_IMAGE_HEIGHT}px`,
      }}
      data-link-preview-image
    >
      <Show
        when={props.src}
        fallback={
          <div
            class="size-full rounded-md border border-edge-muted bg-surface"
            data-link-preview-image-empty
          />
        }
      >
        {(src) => (
          <MediaImage.Image
            src={src()}
            width={LINK_PREVIEW_IMAGE_WIDTH}
            height={LINK_PREVIEW_IMAGE_HEIGHT}
            class={cn(
              'size-full rounded-md border border-edge-muted',
              props.objectContain ? 'object-contain' : 'object-cover'
            )}
            style={{
              width: `${LINK_PREVIEW_IMAGE_WIDTH}px`,
              height: `${LINK_PREVIEW_IMAGE_HEIGHT}px`,
            }}
            fallback={
              <div
                class="flex size-full items-center justify-center rounded-md border border-edge-muted bg-surface"
                data-link-preview-image-placeholder
              >
                <Spinner class="size-4 animate-spin" />
              </div>
            }
          />
        )}
      </Show>
    </div>
  );
}

function LinkPreviewCard(props: {
  unfurled: GetUnfurlResponse;
  onHide?: () => void;
}) {
  const [faviconFailed, setFaviconFailed] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const domain = () => extractDomain(props.unfurled.url);
  const imageBox = () => reservedPreviewImageSize(props.unfurled);

  return (
    <div
      class="group/preview flex h-full min-w-0 flex-col gap-1 border-l-2 border-edge pl-3"
      data-link-preview={props.unfurled.url}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        class="flex min-h-0 shrink-0 flex-col gap-0.5 overflow-hidden"
        style={{ height: `${LINK_PREVIEW_CHROME_HEIGHT}px` }}
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
            {(onHide) => (
              <RemovePreviewButton onHide={onHide()} hovered={hovered()} />
            )}
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
          <p class="line-clamp-2 wrap-break-word text-xs text-ink-muted">
            {props.unfurled.description}
          </p>
        </Show>
      </div>
      <PreviewImageFrame
        src={imageBox() ? proxyResource(props.unfurled.image_url!) : undefined}
        objectContain={imageBox()?.known}
      />
    </div>
  );
}

function LinkPreviewFallback(props: { url: string; onHide?: () => void }) {
  const [hovered, setHovered] = createSignal(false);
  const domain = () => extractDomain(props.url);

  return (
    <div
      class="group/preview flex h-full min-w-0 flex-col gap-1 border-l-2 border-edge pl-3"
      data-link-preview-empty={props.url}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        class="flex min-h-0 shrink-0 flex-col gap-0.5 overflow-hidden"
        style={{ height: `${LINK_PREVIEW_CHROME_HEIGHT}px` }}
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <GlobeIcon class="size-3.5 shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">
            {domain()}
          </span>
          <Show when={props.onHide}>
            {(onHide) => (
              <RemovePreviewButton onHide={onHide()} hovered={hovered()} />
            )}
          </Show>
        </div>
        <a
          href={props.url}
          target="_blank"
          rel="noopener"
          class="line-clamp-2 wrap-break-word text-sm font-medium text-accent hover:underline"
          draggable={false}
          onClick={openLink(props.url)}
        >
          {domain()}
        </a>
      </div>
      <PreviewImageFrame />
    </div>
  );
}

function LinkPreviewSkeleton(props: { url: string; onHide?: () => void }) {
  const [hovered, setHovered] = createSignal(false);

  return (
    <div
      class="group/preview flex h-full min-w-0 flex-col gap-1 border-l-2 border-edge pl-3"
      data-link-preview-loading={props.url}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        class="flex min-h-0 shrink-0 flex-col gap-1.5 overflow-hidden"
        style={{ height: `${LINK_PREVIEW_CHROME_HEIGHT}px` }}
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <div class="skeleton-shimmer size-3.5 shrink-0 rounded-xs bg-skeleton" />
          <div class="skeleton-shimmer h-3 w-24 rounded-full bg-skeleton" />
          <Show when={props.onHide}>
            {(onHide) => (
              <RemovePreviewButton onHide={onHide()} hovered={hovered()} />
            )}
          </Show>
        </div>
        <div class="skeleton-shimmer h-3.5 w-4/5 rounded-full bg-skeleton" />
        <div class="skeleton-shimmer h-2.5 w-full rounded-full bg-skeleton" />
        <div class="skeleton-shimmer h-2.5 w-2/3 rounded-full bg-skeleton" />
      </div>
      <div
        class="flex shrink-0 items-center justify-center self-start rounded-md border border-edge-muted bg-surface"
        style={{
          width: `${LINK_PREVIEW_IMAGE_WIDTH}px`,
          height: `${LINK_PREVIEW_IMAGE_HEIGHT}px`,
        }}
        data-link-preview-image
        data-link-preview-image-placeholder
      >
        <Spinner class="size-4 animate-spin" />
      </div>
    </div>
  );
}

function LinkPreview(props: {
  url: string;
  onRemove: (() => void) | undefined;
}) {
  const [unfurlData] = useUnfurl(props.url);
  const state = () => linkPreviewSlotState(unfurlData());
  const ready = () => {
    const data = unfurlData();
    return data?.type === 'success' && state() === 'ready'
      ? data.data
      : undefined;
  };

  return (
    <PreviewSlot url={props.url}>
      <Switch>
        <Match when={ready()}>
          {(unfurled) => (
            <LinkPreviewCard unfurled={unfurled()} onHide={props.onRemove} />
          )}
        </Match>
        <Match when={state() === 'empty'}>
          <LinkPreviewFallback url={props.url} onHide={props.onRemove} />
        </Match>
        <Match when={true}>
          <LinkPreviewSkeleton url={props.url} onHide={props.onRemove} />
        </Match>
      </Switch>
    </PreviewSlot>
  );
}

type LinkPreviewsProps = {
  /** Enables the sender's "remove preview" action on this message's cards. */
  channelId?: string;
  class?: string;
};

/**
 * Slack-style rich previews for external links in the message body, rendered
 * below the content. Each extracted URL owns a constant-height slot on the
 * first paint (skeleton while unfurl is in flight) so the channel row does
 * not grow when metadata arrives.
 */
export function LinkPreviews(props: LinkPreviewsProps) {
  const message = useMessage();
  const userId = useUserId();
  const removePreview = useRemoveLinkPreviewMutation();
  // Extraction already drops `preview: false` links; the local hidden set is
  // the optimistic layer covering the gap until rewritten content arrives.
  // Memoized on message identity/content so hover/unfurl updates do not
  // rescan the body.
  const previewable = createMemo(() =>
    message().deleted_at ? [] : extractUnfurlableUrls(message().content ?? '')
  );
  const urls = createMemo(() =>
    showLinkPreviews()
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
