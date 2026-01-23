import { UnfurlLink } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { useUnfurl } from '@core/signal/unfurl';
import { cornerClip } from '@core/util/clipPath';
import { debounce } from '@solid-primitives/scheduled';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { floatWithElement } from '../../directive/floatWithElement';

false && floatWithElement;

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

  const [unfurlData] = useUnfurl(props.url);
  // console.log('Getting unfurl data for', props.url);
  // console.log('Unfurl Data:', unfurlData());

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
            class="absolute top-full bg-ink left-0 z-10 -mt-1 shadow-lg max-w-72"
            style={{
              transform: 'translateY(0)',
              filter: 'drop-shadow(0 0 0 2px #3b82f6)',
              'clip-path': cornerClip('0.2rem', 0, 0, 0),
            }}
            use:floatWithElement={{ element: () => linkRef }}
          >
            {(() => {
              const data = unfurlData();
              if (data?.type === 'success') {
                return (
                  <UnfurlLink
                    unfurled={data.data}
                    titleClass="text-panel"
                    subtitleClass="text-panel/70"
                    iconClass="text-panel"
                  />
                );
              }
              return (
                <UnfurlLink
                  unfurled={{
                    url: props.url,
                    title: props.title ?? '',
                  }}
                  titleClass="text-panel"
                  subtitleClass="text-panel/70"
                  iconClass="text-panel"
                />
              );
            })()}
          </div>
        </ScopedPortal>
      </Show>
    </>
  );
}
