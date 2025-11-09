import CaretDown from '@icon/regular/caret-down.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import GlobeIcon from '@icon/regular/globe-simple.svg';
import LinkIcon from '@icon/regular/link.svg';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { createSignal, For, Show } from 'solid-js';
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
export type UnfurlLinkProps = { unfurled: GetUnfurlResponse };

export function UnfurlLink(props: UnfurlLinkProps) {
  const domain = extractDomain(props.unfurled.url);
  let icoRef: HTMLImageElement | undefined;

  return (
    <div
      class="hover:bg-hover p-1 px-2 overflow-clip text-sm transition-colors hover:transition-none"
      onClick={() => window.open(props.unfurled.url)}
    >
      <div class="flex flex-row items-center gap-2 w-full h-full">
        <div class="shrink-0">
          <Show
            when={props.unfurled.favicon_url}
            fallback={<LinkIcon class="w-6 h-6" />}
          >
            {(icon) => (
              <Show
                when={!badLinks[icon()]}
                fallback={<LinkIcon class="w-6 h-6" />}
              >
                <img
                  src={proxyResource(icon())}
                  class="content-center rounded-sm w-6 h-6 object-cover"
                  crossorigin="anonymous"
                  alt="ico"
                  ref={icoRef}
                  on:error={() => {
                    setBadLinks(icon(), true);
                  }}
                />
              </Show>
            )}
          </Show>
        </div>
        <div>
          <h1 class="font-medium text-ink truncate">{props.unfurled.title}</h1>
          <h2 class="font-medium text-ink-muted text-xs">{domain}</h2>
        </div>
      </div>
    </div>
  );
}

interface UnfurledLinkCollection {
  collapsed?: boolean;
  links: GetUnfurlResponse[];
}

export function UnfurledLinkCollection(props: UnfurledLinkCollection) {
  const [isCollapsed, setIsCollapsed] = createSignal(props.collapsed ?? false);

  return (
    <div class="border-1 border-edge rounded-lg w-full text-sm cursor-default select-none">
      <div
        class={`flex justify-between items-center hover:bg-hover transition-colors hover:transition-none py-1 px-2
        ${isCollapsed() ? 'rounded-lg' : 'rounded-t-lg'}
      `}
        onClick={() => setIsCollapsed((p) => !p)}
      >
        <div>
          <div class="flex items-center gap-2">
            <GlobeIcon class="w-6 h-6" />
            <div>
              <div class="flex items-center gap-1 font-medium">Sources</div>
              <div class="flex gap-1 text-xs">
                <p class="font-medium text-ink-muted">
                  {props.links.length > 0
                    ? extractDomain(
                        typeof props.links[0] === 'string'
                          ? props.links[0]
                          : props.links[0].url
                      )
                    : ''}
                </p>
                <Show when={props.links.length > 1}>
                  <p class="font-medium text-accent-ink">
                    +{props.links.length - 1} More
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
        <Show
          when={isCollapsed()}
          fallback={<CaretDown width={20} height={20} />}
        >
          <CaretRight width={20} height={20} />
        </Show>
      </div>
      <div
        class={`flex flex-col divide-y divide-edge ${isCollapsed() ? 'collapse max-h-0' : 'visible max-h-[1920px]'}
        transition-all duration-150 ease-in-out overflow-clip
        `}
      >
        <For each={props.links}>
          {(link) => (
            <div class="first:border-edge first:border-t-1 last:rounded-b-md overflow-clip">
              <UnfurlLink unfurled={link} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
