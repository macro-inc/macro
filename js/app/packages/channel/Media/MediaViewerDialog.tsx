import * as stackingContext from '@core/constant/stackingContext';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { Lightbox, LightboxToolbar } from '@core/component/Lightbox';
import { Button } from '@ui/components/Button';
import { isMobile } from '@core/mobile/isMobile';
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

  let swipeTouchStartX = 0;
  let swipeTouchEndX = 0;
  let isSwiping = false;

  const handleTouchStart = (e: TouchEvent) => {
    const hasNav = props.onPrevious != null || props.onNext != null;
    if (!hasNav || e.touches.length !== 1) return;
    swipeTouchStartX = e.touches[0].clientX;
    swipeTouchEndX = e.touches[0].clientX;
    isSwiping = false;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    swipeTouchEndX = e.touches[0].clientX;
    if (Math.abs(swipeTouchStartX - swipeTouchEndX) > 30) isSwiping = true;
  };

  const handleTouchEnd = () => {
    if (isSwiping) {
      const diff = swipeTouchStartX - swipeTouchEndX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) props.onNext?.();
        else props.onPrevious?.();
      }
    }
    isSwiping = false;
    swipeTouchStartX = 0;
    swipeTouchEndX = 0;
  };

  return (
    <div
      class="fixed inset-0 z-modal flex items-center justify-center"
      style={{
        'margin-top': 'max(var(--safe-top), 0.5rem)',
        'margin-bottom': 'max(var(--safe-bottom), 1.5rem)',
        'margin-left': 'max(var(--safe-left), 0.5rem)',
        'margin-right': 'max(var(--safe-right), 0.5rem)',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Dialog.Content class="flex items-center justify-center bg-panel">
        <LightboxToolbar isVisible={true}>
          <Dialog.CloseButton>
            <Button
              variant="ghost"
              size="icon-md"
              tooltip={<LabelAndHotKey label="Close" />}
            >
              <XIcon />
            </Button>
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

        <Show when={!isMobile() && !props.navigationHidden}>
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
