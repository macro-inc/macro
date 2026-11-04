import { UploadProgressIndicator } from '@core/component/UploadProgress/UploadProgressIndicator';
import { isMobile } from '@core/mobile/isMobile';
import { createElementSize } from '@core/util/createElementSize';
import { Toast } from '@kobalte/core/toast';
import { cn } from '@ui/utils/classname';
import { createSignal, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createMobileToastSwipe } from './create-mobile-toast-swipe';

/** A column centered above the mobile dock, `lift` higher than its usual spot. */
function MobileToastStack(props: {
  ref?: (element: HTMLDivElement) => void;
  class: string;
  lift?: string;
  children: JSX.Element;
}) {
  return (
    <div
      ref={props.ref}
      class={cn(
        'fixed left-1/2 -translate-x-1/2 w-full max-w-lg px-(--mobile-chrome-gutter) pointer-events-none flex flex-col gap-5',
        props.class
      )}
      style={{
        bottom: `calc(var(--mobile-content-inset-bottom, 0px) + 12px + ${props.lift ?? '0px'})`,
      }}
    >
      {props.children}
    </div>
  );
}

export function ToastRegion() {
  const mobileSwipe = createMobileToastSwipe();
  const [mobileTransientStack, setMobileTransientStack] =
    createSignal<HTMLDivElement>();
  const mobileTransientSize = createElementSize(mobileTransientStack);

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
        Mobile-only stacks: centered above the mobile dock. At most one
        transient toast is visible — Toast.tsx dismisses the previous one as
        soon as a new one is shown. Persistent prompts live in their own
        region above that slot, capped at one visible card with the rest
        queued until it is answered.

        They need separate stacks, each `fixed` and so its own stacking
        context: prompts go under the modal stack so they never cover a sheet
        or the picker on it, while transient toasts stay above sheets. The
        prompt stack measures the transient one to stay above that slot.
      */}
      <div
        class="contents"
        on:pointerdown={{
          capture: true,
          handleEvent: mobileSwipe.onPointerDown,
        }}
        on:pointermove={{
          capture: true,
          handleEvent: mobileSwipe.onPointerMove,
        }}
        on:pointerup={{ capture: true, handleEvent: mobileSwipe.clearSwipe }}
        on:pointercancel={{
          capture: true,
          handleEvent: mobileSwipe.clearSwipe,
        }}
      >
        <MobileToastStack
          class="z-mobile-prompt-region"
          lift={`${mobileTransientSize.height ?? 0}px + 1.25rem`}
        >
          <Toast.Region
            class="macro-toast-region"
            regionId="mobile-reminder-region"
            duration={Infinity}
            limit={1}
            pauseOnInteraction={false}
            swipeDirection={mobileSwipe.direction()}
          >
            <Toast.List class="macro-toast-list" />
          </Toast.Region>
          <Toast.Region
            class="macro-toast-region"
            regionId="mobile-prompt-region"
            duration={Infinity}
            limit={1}
            pauseOnInteraction={false}
            swipeDirection={mobileSwipe.direction()}
          >
            <Toast.List class="macro-toast-list" />
          </Toast.Region>
        </MobileToastStack>
        <MobileToastStack ref={setMobileTransientStack} class="z-toast-region">
          <Toast.Region
            class="macro-toast-region"
            regionId="mobile-toast-region"
            limit={1}
            duration={4500}
            pauseOnInteraction
            swipeDirection={mobileSwipe.direction()}
          >
            <Toast.List class="macro-toast-list" />
          </Toast.Region>
          <Show when={isMobile()}>
            <div class="flex justify-center">
              <UploadProgressIndicator />
            </div>
          </Show>
        </MobileToastStack>
      </div>
    </Portal>
  );
}
