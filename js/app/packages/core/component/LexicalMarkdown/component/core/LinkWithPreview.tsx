import { UnfurlLink } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { useUnfurl } from '@core/signal/unfurl';
import { debounce } from '@solid-primitives/scheduled';
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
        class={`${props.class || ''}`}
        onMouseEnter={() => debouncedSetPreviewOpen(true)}
        onMouseLeave={() => {
          debouncedSetPreviewOpen.clear();
          debouncedSetPreviewOpen(false);
        }}
        draggable={false}
      >
        {props.children}
      </a>
      <Show when={previewOpen()}>
        <ScopedPortal>
          <div
            class="p-1 absolute top-full left-0 z-10 bg-menu rounded-lg w-80 shadow-lg ring-edge ring-1 mt-2"
            style={{
              transform: 'translateY(0)',
            }}
            use:floatWithElement={{ element: () => linkRef }}
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
