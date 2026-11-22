import { LinkHoverCard } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useUnfurl } from '@core/signal/unfurl';
import { openExternalUrl } from '@core/util/url';
import { flip, hide, offset, shift } from '@floating-ui/dom';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { floatWithElement } from '../../directive/floatWithElement';
import { iosSafePadding } from '../../directive/iosFloatingMiddleware';
import { useAppLinkDescriber, useAppLinkOpener } from './app-link-opener';

false && floatWithElement;

/** The nearest ancestor that scrolls, such as an agent transcript's column. */
function scrollColumn(element: Element | undefined): Element | undefined {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return undefined;
}

type LinkWithPreviewProps = ParentProps<{
  url: string;
  title?: string;
  class?: string;
}>;

export function LinkWithPreview(props: LinkWithPreviewProps) {
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const debouncedSetPreviewOpen = debounce((val: boolean) => {
    setPreviewOpen(val);
  });

  const openAppLink = useAppLinkOpener();
  const describeLink = useAppLinkDescriber();
  // Only a web page unfurls: a relative link, such as a path to code, never
  // goes to the unfurl service.
  const [unfurlData] = useUnfurl(
    /^https?:\/\//i.test(props.url) ? props.url : undefined
  );

  let linkRef: HTMLAnchorElement | undefined;

  return (
    <>
      <a
        ref={linkRef}
        href={props.url}
        target="_blank"
        class={cn(props.class)}
        onClick={(e) => {
          // Modified/middle clicks keep native anchor behavior (background
          // tab etc.). Plain clicks open in the app where the surface says
          // so, otherwise through openExternalUrl, so macro links open
          // in-app under Tauri.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          if (openAppLink?.(props.url)) return;
          openExternalUrl(props.url);
        }}
        onMouseEnter={() => {
          if (isTouchDevice()) return;
          debouncedSetPreviewOpen(true);
        }}
        onMouseLeave={() => {
          debouncedSetPreviewOpen.clear();
          debouncedSetPreviewOpen(false);
        }}
        draggable={false}
        rel="noopener"
      >
        {props.children}
      </a>
      <Show when={previewOpen()}>
        <ScopedPortal>
          <div
            class="absolute left-0 z-10"
            style={{
              transform: 'translateY(0)',
            }}
            // Kept inside the column the link scrolls in, so the card neither
            // covers the icon rail nor reaches into a pane beside it.
            use:floatWithElement={{
              element: () => linkRef,
              spacing: 4,
              floatingOptions: {
                middleware: [
                  offset(4),
                  flip({
                    padding: iosSafePadding(4),
                    boundary: scrollColumn(linkRef) ?? 'clippingAncestors',
                  }),
                  shift({
                    padding: 4,
                    boundary: scrollColumn(linkRef) ?? 'clippingAncestors',
                  }),
                  hide(),
                ],
              },
            }}
          >
            {(() => {
              const described = describeLink?.(props.url);
              if (described) {
                return (
                  <LinkHoverCard
                    unfurled={{ url: props.url, title: described.title }}
                    subtitle={described.subtitle}
                  />
                );
              }
              const data = unfurlData();
              if (data?.type === 'success') {
                return <LinkHoverCard unfurled={data.data} />;
              }
              return (
                <LinkHoverCard
                  unfurled={{
                    url: props.url,
                    title: props.title ?? '',
                  }}
                />
              );
            })()}
          </div>
        </ScopedPortal>
      </Show>
    </>
  );
}
