import { openExternalUrl } from '@core/util/url';
import LinkIcon from '@phosphor/link.svg';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
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
 * The shared card shown when hovering a link in rendered or editable Markdown.
 */
export function LinkHoverCard(props: LinkHoverCardProps) {
  const domain = extractDomain(props.unfurled.url);
  const title = () => props.unfurled.title || domain;

  return (
    <div class="flex w-80 max-w-[calc(100vw-1rem)] items-start gap-1 rounded-xl border border-edge p-2 text-left shadow-menu bg-menu">
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
