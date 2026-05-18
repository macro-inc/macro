import { Toast } from '@kobalte/core/toast';
import { Portal } from 'solid-js/web';

export function ToastRegion() {
  return (
    <Portal>
      <div class="fixed bottom-2 right-2 m-0 list-none outline-none pointer-events-none z-toast-region">
        <Toast.Region
          regionId="toast-region"
          duration={Infinity}
          pauseOnInteraction={false}
        >
          <Toast.List class="absolute bottom-0 right-0 flex flex-col p-2 sm:p-4 gap-2" />
        </Toast.Region>
        <Toast.Region regionId="stable-toast" duration={Infinity}>
          <Toast.List class="absolute bottom-0 right-0 flex flex-col p-2 sm:p-4 gap-2" />
        </Toast.Region>
      </div>

      {/*
        Mobile-only region: centered above the mobile dock. Only one toast is
        ever visible — Toast.tsx dismisses the previous mobile toast as soon
        as a new one is shown, so no stacking is needed here.
      */}
      <div
        class="fixed left-1/2 -translate-x-1/2 w-full max-w-[420px] px-4 pointer-events-none z-toast-region"
        style={{
          bottom: 'calc(var(--safe-bottom, 0px) + 104px)',
        }}
      >
        <Toast.Region
          regionId="mobile-toast-region"
          duration={Infinity}
          pauseOnInteraction={false}
        >
          <Toast.List class="flex flex-col" />
        </Toast.Region>
      </div>
    </Portal>
  );
}
