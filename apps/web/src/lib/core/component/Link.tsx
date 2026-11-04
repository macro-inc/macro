import { displayImageUrl, isImageProxyUrl } from '@core/util/imageProxy';
import { openExternalUrl } from '@core/util/url';
import LinkIcon from '@icon/system/regular/link.svg';
import type { LinkPreview } from '@service-storage/messages';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import type { GetUnfurlResponseFaviconUrl } from '@service-unfurl/generated/schemas/getUnfurlResponseFaviconUrl';
import { UnfurlEmbedType } from '@service-unfurl/generated/schemas/unfurlEmbedType';
import { cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

function extractDomain(url: string) {
  try {
    const address = new URL('', url);
    return address.hostname;
  } catch {
    return url;
  }
}

const [badLinks, setBadLinks] = createStore<Record<string, true>>({});

/** A page's favicon, or a link glyph when it has none or it fails to load. */
function Favicon(props: {
  url: GetUnfurlResponseFaviconUrl | undefined;
  class: string;
}) {
  const iconUrl = () => {
    const url = props.url;
    if (!url || badLinks[url]) return;
    return url;
  };

  return (
    <Show
      when={iconUrl()}
      fallback={<LinkIcon class="size-4 shrink-0 text-ink-muted" />}
    >
      {(icon) => (
        <img
          src={proxyResource(icon())}
          class={cn('shrink-0 object-cover', props.class)}
          crossorigin="anonymous"
          alt=""
          on:error={() => {
            setBadLinks(icon(), true);
          }}
        />
      )}
    </Show>
  );
}

type UnfurlLinkProps = {
  unfurled: GetUnfurlResponse;
  size?: 'xs' | 'sm';
};

type LinkHoverCardProps = {
  unfurled: GetUnfurlResponse;
};

/**
 * Video embed component for services like Loom and Supercut.
 */
function VideoEmbed(props: { embedUrl: string; title: string }) {
  return (
    <div class="menu-surface w-80 max-w-[calc(100vw-1rem)] overflow-hidden">
      <div class="relative aspect-video w-full">
        <iframe
          src={props.embedUrl}
          class="absolute inset-0 size-full rounded-t-xl"
          allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          title={props.title}
        />
      </div>
      <div class="px-2 py-1.5">
        <div class="truncate text-xs font-medium text-ink">{props.title}</div>
      </div>
    </div>
  );
}

/**
 * The shared card shown when hovering a link in rendered or editable Markdown.
 * For embeddable video content (Loom, Supercut), renders an iframe player.
 */
export function LinkHoverCard(props: LinkHoverCardProps) {
  const domain = extractDomain(props.unfurled.url);
  const title = () => props.unfurled.title || domain;

  return (
    <Show
      when={
        props.unfurled.embed_type === UnfurlEmbedType.Video &&
        props.unfurled.embed_url
      }
      fallback={
        <div class="menu-surface flex w-80 max-w-[calc(100vw-1rem)] items-start gap-1 p-2 text-left">
          <div class="flex size-6 shrink-0 items-center justify-center">
            <Favicon
              url={props.unfurled.favicon_url}
              class="size-5 rounded-md"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm/6 font-medium text-ink">{title()}</div>
            <div class="truncate text-xs text-ink-muted">{domain}</div>
          </div>
        </div>
      }
    >
      <VideoEmbed embedUrl={props.unfurled.embed_url!} title={title()} />
    </Show>
  );
}

export function UnfurlLink(props: UnfurlLinkProps) {
  const domain = extractDomain(props.unfurled.url);

  return (
    <div
      class={cn(
        'hover:bg-hover p-1 px-1.5 overflow-clip transition-colors hover:transition-none',
        props.size === 'sm' ? 'text-sm' : 'text-xs'
      )}
      onClick={() => openExternalUrl(props.unfurled.url)}
    >
      <div class="flex flex-row items-center gap-1.5 size-full">
        <div class="shrink-0">
          <Favicon url={props.unfurled.favicon_url} class="size-4 rounded-sm" />
        </div>
        <div class="min-w-0">
          <h1 class="font-medium truncate text-ink">
            {props.unfurled.title || domain}
          </h1>
          <h2
            class={cn(
              'font-medium text-ink-muted',
              props.size === 'sm' ? 'text-sm' : 'text-xxs'
            )}
          >
            {domain}
          </h2>
        </div>
      </div>
    </div>
  );
}

/**
 * A link's preview as a card beneath the text it appears in: the site, the
 * page title and description, and its preview image as a thumbnail. Opens
 * the link like the link itself does.
 */
export function LinkPreviewCard(props: { preview: LinkPreview }) {
  const domain = () => extractDomain(props.preview.url);
  const [failedImageSrc, setFailedImageSrc] = createSignal<string>();
  const imageSrc = () => {
    const url = props.preview.image_url;
    if (!url) return;

    const src = displayImageUrl(url);
    if (src === failedImageSrc()) return;
    return src;
  };

  return (
    <a
      href={props.preview.url}
      target="_blank"
      rel="noopener"
      draggable={false}
      class="flex w-full max-w-md items-start gap-3 overflow-hidden whitespace-normal rounded-xl border border-edge-muted p-3 text-left not-touch:hover:border-accent hover-transition-border focus-visible:outline-2 focus-visible:outline-accent"
      onClick={(event) => {
        // Modified/middle clicks keep native anchor behavior; plain clicks go
        // through openExternalUrl so Macro links open in-app under Tauri.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        openExternalUrl(props.preview.url);
      }}
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 text-xs text-ink-muted">
          <Favicon url={props.preview.favicon_url} class="size-4 rounded-sm" />
          <span class="truncate">{domain()}</span>
        </div>
        <div class="mt-1 line-clamp-2 text-sm font-medium text-ink">
          {props.preview.title || domain()}
        </div>
        <Show when={props.preview.description}>
          {(description) => (
            <div class="mt-0.5 line-clamp-2 text-sm text-ink-muted">
              {description()}
            </div>
          )}
        </Show>
      </div>
      <Show when={imageSrc()}>
        {(src) => (
          <img
            src={src()}
            crossorigin={
              isImageProxyUrl(src()) ? 'use-credentials' : 'anonymous'
            }
            alt=""
            class="size-16 shrink-0 rounded-lg bg-edge-muted object-cover"
            on:error={() => setFailedImageSrc(src())}
          />
        )}
      </Show>
    </a>
  );
}
