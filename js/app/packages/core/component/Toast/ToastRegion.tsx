import { Toast } from '@kobalte/core/toast';
import { Portal } from 'solid-js/web';

export function ToastRegion() {
  return (
    <Portal>
      <div class="fixed bottom-[40px] sm:bottom-0 right-0 w-[90%] sm:w-108 m-0 list-none outline-none pointer-events-none z-toast-region">
        <Toast.Region regionId="toast-region" duration={6000}>
          <Toast.List class="flex flex-col p-4 gap-2" />
        </Toast.Region>
        <Toast.Region regionId="stable-toast" duration={Infinity}>
          <Toast.List class="flex flex-col p-4 gap-2" />
        </Toast.Region>
      </div>
    </Portal>
  );
}
