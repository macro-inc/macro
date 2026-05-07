import { UnfurlLink } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useUnfurl } from '@core/signal/unfurl';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { floatWithElement } from '../../directive/floatWithElement';

false && floatWithElement;

type UnfurlLinkProps = ParentProps<{
  url: string;
  title?: string;
  class?: string;
}>;

export function LinkWithPreview(props: UnfurlLinkProps) {
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const debouncedSetPreviewOpen = debounce((val: boolean) => {
    setPreviewOpen(val);
  });

  const [unfurlData] = useUnfurl(props.url);

  let linkRef: HTMLAnchorElement | undefined;

  return (
    <>
      <a
        ref={linkRef}
        href={props.url}
        target="_blank"
        class={cn(props.class)}
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
            class="absolute bg-panel rounded-xs ring ring-edge-muted border-edge left-0 z-10 shadow-lg max-w-72"
            style={{
              transform: 'translateY(0)',
            }}
            use:floatWithElement={{ element: () => linkRef, spacing: 4 }}
          >
            {(() => {
              const data = unfurlData();
              if (data?.type === 'success') {
                return <UnfurlLink unfurled={data.data} />;
              }
              return (
                <UnfurlLink
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
