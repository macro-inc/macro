import * as stackingContext from '@core/constant/stackingContext';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { Lightbox, LightboxToolbar } from '@core/component/Lightbox';
import ChevronLeftIcon from '@icon/regular/caret-left.svg';
import ChevronRightIcon from '@icon/regular/caret-right.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { Show, type Accessor, createMemo } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { MediaItem } from './media-items';

type MediaViewerDialogProps = {
  items: Accessor<MediaItem[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentIndex: Accessor<number>;
  onCurrentIndexChange: (index: number) => void;
};

function VideoViewerContent(props: {
  item: Accessor<MediaItem>;
  onPrevious?: () => void;
  onNext?: () => void;
  indexLabel?: Accessor<string>;
  navigationHidden?: boolean;
}) {
  const navButtonClass =
    'absolute top-1/2 -translate-y-1/2 bg-dialog backdrop-blur-sm rounded-lg border border-edge p-2 shadow-md hover:bg-button transition-colors disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div
      class="fixed inset-0 z-modal flex items-center justify-center"
      style={{
        'padding-top': 'max(var(--safe-top), 0.5rem)',
        'padding-bottom': 'max(var(--safe-bottom), 1.5rem)',
        'padding-left': 'max(var(--safe-left), 0.5rem)',
        'padding-right': 'max(var(--safe-right), 0.5rem)',
      }}
    >
      <Dialog.Content class="flex items-center justify-center bg-panel">
        <LightboxToolbar isVisible={true}>
          <Dialog.CloseButton>
            <DeprecatedIconButton
              icon={XIcon}
              theme="clear"
              tooltip={{ label: 'Close' }}
            />
          </Dialog.CloseButton>
        </LightboxToolbar>

        <Show when={props.indexLabel}>
          <div
            class="absolute top-4 left-4 rounded-lg border border-edge bg-dialog px-3 py-1.5 shadow-md"
            style={{ 'z-index': stackingContext.zModal + 1 }}
          >
            <span class="text-sm font-medium text-ink">
              {props.indexLabel?.()}
            </span>
          </div>
        </Show>

        <Show when={!props.navigationHidden}>
          <button
            class={cn(navButtonClass, 'left-4')}
            style={{ 'z-index': stackingContext.zModal + 1 }}
            onClick={props.onPrevious}
            disabled={!props.onPrevious}
            aria-label="Previous media"
          >
            <ChevronLeftIcon class="h-5 w-5 text-ink" />
          </button>

          <button
            class={cn(navButtonClass, 'right-4')}
            style={{ 'z-index': stackingContext.zModal + 1 }}
            onClick={props.onNext}
            disabled={!props.onNext}
            aria-label="Next media"
          >
            <ChevronRightIcon class="h-5 w-5 text-ink" />
          </button>
        </Show>

        <div class="flex h-full w-full items-center justify-center">
          <video
            class="max-h-[80vh] max-w-[90vw] rounded-2xl bg-black"
            controls
            autoplay
            playsinline
            src={props.item().fullSrc}
          />
        </div>
      </Dialog.Content>
    </div>
  );
}

export function MediaViewerDialog(props: MediaViewerDialogProps) {
  const currentItem = createMemo(() => props.items()[props.currentIndex()]);
  const hasPrevious = () => props.currentIndex() > 0;
  const hasNext = () => props.currentIndex() < props.items().length - 1;
  const hasMultipleItems = () => props.items().length > 1;
  const indexLabel = () =>
    `${props.currentIndex() + 1}/${props.items().length}`;

  const navigatePrevious = () => {
    if (!hasPrevious()) return;
    props.onCurrentIndexChange(props.currentIndex() - 1);
  };

  const navigateNext = () => {
    if (!hasNext()) return;
    props.onCurrentIndexChange(props.currentIndex() + 1);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
        <Show when={currentItem()}>
          {(item) => (
            <Show
              when={item().kind === 'image'}
              fallback={
                <VideoViewerContent
                  item={item}
                  onPrevious={hasPrevious() ? navigatePrevious : undefined}
                  onNext={hasNext() ? navigateNext : undefined}
                  indexLabel={hasMultipleItems() ? indexLabel : undefined}
                  navigationHidden={!hasMultipleItems()}
                />
              }
            >
              <Lightbox
                src={() => item().fullSrc}
                imageId={() => item().id}
                onPrevious={hasPrevious() ? navigatePrevious : undefined}
                onNext={hasNext() ? navigateNext : undefined}
                navigationHidden={!hasMultipleItems()}
                indexLabel={hasMultipleItems() ? indexLabel : undefined}
              />
            </Show>
          )}
        </Show>
      </Dialog.Portal>
    </Dialog>
  );
}
