import { Toast } from '@kobalte/core/toast';
import { Portal } from 'solid-js/web';

export function ToastRegion() {
  return (
    <Portal>
      <div class="fixed bottom-23.5 sm:bottom-12 right-0 m-0 list-none outline-none pointer-events-none z-toast-region">
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
    </Portal>
  );
}
