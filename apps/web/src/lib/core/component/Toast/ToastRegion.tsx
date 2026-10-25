import { UploadProgressIndicator } from '@core/component/UploadProgress/UploadProgressIndicator';
import { isMobile } from '@core/mobile/isMobile';
import { Toast } from '@kobalte/core/toast';
import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';

export function ToastRegion() {
  return (
    <Portal>
      {/*
        Desktop stack, bottom-right. Persistent prompts get their own region
        capped at one visible card. Upload progress sits nearest the corner.
        Prompts step aside while a popover, dialog, drawer, or a surface
        marked data-holds-prompts is open, so they never cover its controls
        (here: composers docked at the bottom of a pane, email threads, the
        email composer, and a composer's typeahead and picker menus); a holder
        in an inert (background) pane does not count.
      */}
      <div class="fixed bottom-2 right-2 m-0 p-2 sm:p-4 list-none outline-none pointer-events-none z-toast-region flex flex-col items-end gap-2">
        <Toast.Region
          regionId="reminder-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="right"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
        <Toast.Region
          regionId="prompt-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="right"
          class="in-[body:has([role=dialog],[role=alertdialog],[data-holds-prompts]:not([inert],[inert]_*))]:hidden"
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
        <Show when={!isMobile()}>
          <UploadProgressIndicator />
        </Show>
      </div>

      {/*
        Mobile-only stack: centered above the mobile dock. At most one
        transient toast is visible — Toast.tsx dismisses the previous one as
        soon as a new one is shown. Persistent prompts live in their own
        region above that slot, capped at one visible card with the rest
        queued until it is answered. Prompts step aside as on desktop: while a
        drawer, sheet, or dialog is open, or a full-frame view that holds them
        (composer, email thread, search) is presented.
      */}
      <div
        class="fixed left-1/2 -translate-x-1/2 w-full max-w-[420px] px-(--mobile-chrome-gutter) pointer-events-none z-toast-region flex flex-col gap-2"
        style={{
          bottom: 'calc(var(--mobile-content-inset-bottom, 0px) + 12px)',
        }}
      >
        <Toast.Region
          regionId="mobile-reminder-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="left"
        >
          <Toast.List class="flex flex-col gap-2" />
        </Toast.Region>
        <Toast.Region
          regionId="mobile-prompt-region"
          duration={Infinity}
          limit={1}
          pauseOnInteraction={false}
          swipeDirection="left"
          class="in-[body:has([role=dialog],[role=alertdialog],[data-holds-prompts]:not([inert],[inert]_*))]:hidden"
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
        <Show when={isMobile()}>
          <div class="flex justify-center">
            <UploadProgressIndicator />
          </div>
        </Show>
      </div>
    </Portal>
  );
}
