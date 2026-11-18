import { TouchTopBarFade } from '@app/components/view-shell/touch-top-bar';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getSafeAreaInset } from '@core/mobile/safeAreaInsets';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type JSX } from 'solid-js';

/** Keep touch conversation chrome inside its preview and messages full-frame. */
export function ChannelDetailLayout(props: {
  header: JSX.Element;
  scrollBehindHeader: boolean;
  children: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const [header, setHeader] = createSignal<HTMLElement>();
  const size = createElementSize(header);
  const contentOffsetTop = () =>
    isTouchDevice()
      ? (size.height ?? getSafeAreaInset('top') + 60)
      : panel.contentOffsetTop();

  return (
    <SplitPanelContext.Provider
      value={{
        ...panel,
        contentOffsetTop: () =>
          isTouchDevice() && !props.scrollBehindHeader ? 0 : contentOffsetTop(),
      }}
    >
      <div
        data-channel-detail-layout
        class="relative flex size-full min-h-0 min-w-0 flex-col"
        style={
          isTouchDevice()
            ? { '--mobile-content-inset-top': `${contentOffsetTop()}px` }
            : undefined
        }
      >
        <div
          ref={setHeader}
          data-channel-detail-header
          class="shrink-0 touch:pointer-events-none touch:absolute touch:inset-x-0 touch:top-0 touch:z-split-panel-chrome touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)] touch:pb-3"
        >
          {props.header}
        </div>
        <div
          data-channel-tab-content
          class="relative flex min-h-0 flex-1 flex-col px-2"
          style={
            isTouchDevice() && !props.scrollBehindHeader
              ? {
                  'padding-top': `${contentOffsetTop()}px`,
                  '--mobile-content-inset-top': '0px',
                }
              : undefined
          }
        >
          {props.children}
        </div>
        <TouchTopBarFade height={contentOffsetTop()} />
      </div>
    </SplitPanelContext.Provider>
  );
}
