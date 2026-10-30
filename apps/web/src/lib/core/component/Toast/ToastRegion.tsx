import { UploadProgressIndicator } from '@core/component/UploadProgress/UploadProgressIndicator';
import { isMobile } from '@core/mobile/isMobile';
import { Toast } from '@kobalte/core/toast';
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

export function ToastRegion() {
  const [mobileSwipeDirection, setMobileSwipeDirection] = createSignal<
    'left' | 'right'
  >('left');
  let swipeStart: { x: number; pointerId: number } | undefined;
  const clearSwipe = (event: PointerEvent) => {
    if (swipeStart?.pointerId === event.pointerId) swipeStart = undefined;
  };

  return (
    <Portal>
      {/*
        Desktop stack, bottom-right. Persistent prompts get their own region
        capped at one visible card. Ordinary notices form an expandable three-card stack. Upload progress sits nearest the corner.
      */}
      <div class="fixed bottom-5 right-5 m-0 w-[380px] max-w-[calc(100vw-32px)] list-none outline-none pointer-events-none z-toast-region flex flex-col items-stretch gap-4">
        <Toast.Region
          class="macro-toast-region"
          regionId="reminder-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="right"
        >
          <Toast.List class="macro-toast-list" />
        </Toast.Region>
        <Toast.Region
          class="macro-toast-region"
          regionId="prompt-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="right"
        >
          <Toast.List class="macro-toast-list" />
        </Toast.Region>
        <Toast.Region
          class="macro-toast-region"
          regionId="toast-region"
          limit={3}
          duration={4500}
          pauseOnInteraction
          swipeDirection="right"
        >
          <Toast.List class="macro-toast-list" data-stack />
        </Toast.Region>
        <Show when={!isMobile()}>
          <UploadProgressIndicator />
        </Show>
      </div>

      {/*
        Mobile-only stack: centered above the mobile dock. At most one
        transient toast is visible — Toast.tsx dismisses the previous one as
        soon as a new one is shown. Persistent prompts live in their own
        region above that slot, capped at one visible card with the rest
        queued until it is answered.
      */}
      <div
        class="fixed left-1/2 -translate-x-1/2 w-full max-w-[420px] px-(--mobile-chrome-gutter) pointer-events-none z-toast-region flex flex-col gap-5"
        on:pointerdown={{
          capture: true,
          handleEvent: (event) => {
            if (event.button === 0)
              swipeStart = { x: event.clientX, pointerId: event.pointerId };
          },
        }}
        on:pointermove={{
          capture: true,
          handleEvent: (event) => {
            if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - swipeStart.x;
            // Choose the direction before Kobalte clamps this pointer move.
            if (deltaX !== 0)
              setMobileSwipeDirection(deltaX < 0 ? 'left' : 'right');
          },
        }}
        on:pointerup={{ capture: true, handleEvent: clearSwipe }}
        on:pointercancel={{ capture: true, handleEvent: clearSwipe }}
        style={{
          bottom: 'calc(var(--mobile-content-inset-bottom, 0px) + 12px)',
        }}
      >
        <Toast.Region
          class="macro-toast-region"
          regionId="mobile-reminder-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection={mobileSwipeDirection()}
        >
          <Toast.List class="macro-toast-list" />
        </Toast.Region>
        <Toast.Region
          class="macro-toast-region"
          regionId="mobile-prompt-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection={mobileSwipeDirection()}
        >
          <Toast.List class="macro-toast-list" />
        </Toast.Region>
        <Toast.Region
          class="macro-toast-region"
          regionId="mobile-toast-region"
          limit={1}
          duration={4500}
          pauseOnInteraction
          swipeDirection={mobileSwipeDirection()}
        >
          <Toast.List class="macro-toast-list" />
        </Toast.Region>
        <Show when={isMobile()}>
          <div class="flex justify-center">
            <UploadProgressIndicator />
          </div>
        </Show>
      </div>
    </Portal>
  );
}
