import { showLinuxNotification } from '../../../src/lib/tauri/linux-notification';

declare global {
  interface Window {
    notificationFixture: {
      show: () => Promise<void>;
      close: (index: number) => void;
      clicked: number[];
      dismissed: number[];
    };
  }
}

const handles: Awaited<ReturnType<typeof showLinuxNotification>>[] = [];
window.notificationFixture = {
  clicked: [],
  dismissed: [],
  async show() {
    const index = handles.length;
    const handle = await showLinuxNotification(`Notification ${index}`);
    handles.push(handle);
    handle.onClick(() => {
      window.notificationFixture.clicked.push(index);
      // The production navigation callback owns the destination; this fixture
      // verifies that native activation reaches the correct frontend callback.
      location.hash = `notification-${index}`;
      handle.close();
    });
    handle.onDismiss(() => window.notificationFixture.dismissed.push(index));
  },
  close(index) {
    handles[index].close();
  },
};
document.documentElement.dataset.ready = 'true';
