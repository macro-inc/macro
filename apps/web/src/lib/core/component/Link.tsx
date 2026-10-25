import { openExternalUrl } from '@core/util/url';
import LinkIcon from '@phosphor/link.svg';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { UnfurlEmbedType } from '@service-unfurl/generated/schemas/unfurlEmbedType';
import { cn } from '@ui';
import { Show } from 'solid-js';
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
            <Show
              when={props.unfurled.favicon_url}
              fallback={<LinkIcon class="size-4 text-ink-muted" />}
            >
              {(icon) => (
                <Show
                  when={!badLinks[icon()]}
                  fallback={<LinkIcon class="size-4 text-ink-muted" />}
                >
                  <img
                    src={proxyResource(icon())}
                    class="size-5 rounded-md object-cover"
                    crossorigin="anonymous"
                    alt=""
                    on:error={() => {
                      setBadLinks(icon(), true);
                    }}
                  />
                </Show>
              )}
            </Show>
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
          <Show
            when={props.unfurled.favicon_url}
            fallback={<LinkIcon class="size-4" />}
          >
            {(icon) => (
              <Show
                when={!badLinks[icon()]}
                fallback={<LinkIcon class="size-4" />}
              >
                <img
                  src={proxyResource(icon())}
                  class="content-center rounded-sm size-4 object-cover"
                  crossorigin="anonymous"
                  alt="ico"
                  on:error={() => {
                    setBadLinks(icon(), true);
                  }}
                />
              </Show>
            )}
          </Show>
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
