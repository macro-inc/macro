import { Toast } from '@kobalte/core/toast';
import { Portal } from 'solid-js/web';

export function ToastRegion() {
  return (
    <Portal>
      {/*
        Desktop stack, bottom-right. Persistent prompts get their own region
        capped at one visible card.
      */}
      <div class="fixed bottom-2 right-2 m-0 p-2 sm:p-4 list-none outline-none pointer-events-none z-toast-region flex flex-col items-end gap-2">
        <Toast.Region
          regionId="prompt-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="right"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
        <Toast.Region
          regionId="toast-region"
          duration={Infinity}
          pauseOnInteraction={false}
          swipeDirection="right"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
        <Toast.Region
          regionId="stable-toast"
          duration={Infinity}
          swipeDirection="right"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
      </div>

      {/*
        Mobile-only stack: centered above the mobile dock. At most one
        transient toast is visible — Toast.tsx dismisses the previous one as
        soon as a new one is shown. Persistent prompts live in their own
        region above that slot, capped at one visible card with the rest
        queued until it is answered.
      */}
      <div
        class="fixed left-1/2 -translate-x-1/2 w-full max-w-[420px] px-(--mobile-chrome-gutter) pointer-events-none z-toast-region flex flex-col gap-2"
        style={{
          bottom: 'calc(var(--mobile-content-inset-bottom, 0px) + 12px)',
        }}
      >
        <Toast.Region
          regionId="mobile-prompt-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="left"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
        <Toast.Region
          regionId="mobile-toast-region"
          duration={Infinity}
          pauseOnInteraction={false}
          swipeDirection="left"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
      </div>
    </Portal>
  );
}
