import {
  finishNotificationNavigation,
  pendingNotificationNavigation,
  receiveNotificationTap,
} from '@notifications/notification-navigation-intent';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createRoot } from 'solid-js';
import { useNotificationCoverTimeout } from '../notification-launch';
import { createPushApi } from '../push-api';

const cover = document.getElementById('cover');
const navigate = document.getElementById('navigate');
const navigation = document.getElementById('navigation');
if (!cover || !navigate || !navigation) throw new Error('Missing fixture UI');

const commands: string[] = [];
let nativePending: string | undefined;
const frames: FrameRequestCallback[] = [];
const requestFrame = window.requestAnimationFrame;
window.__MACRO_IOS_NOTIFICATION_LAUNCH__ = true;
mockIPC((command, payload) => {
  commands.push(command);
  if (command === 'plugin:notifications|release_notification_cover') {
    cover.hidden = true;
    return;
  }
  if (command === 'plugin:notifications|acknowledge_notification') {
    if (
      payload &&
      'deliveryId' in payload &&
      payload.deliveryId === nativePending
    ) {
      nativePending = undefined;
      cover.hidden = true;
    }
    return;
  }
  throw new Error(`Unexpected native command: ${command}`);
});

const push = createPushApi('ios');
const dispose = createRoot((dispose) => {
  useNotificationCoverTimeout();
  return dispose;
});
window.addEventListener('pagehide', dispose, { once: true });
navigate.addEventListener('click', () => {
  navigation.textContent = 'Another page';
});

const fixture = {
  tap(deliveryId: string) {
    nativePending = deliveryId;
    cover.hidden = false;
    receiveNotificationTap(
      {
        type: 'BACKGROUND_TAP',
        payload: { notificationId: deliveryId },
        deliveryId,
      },
      push.acknowledge
    );
  },
  complete() {
    const intent = pendingNotificationNavigation();
    if (intent) finishNotificationNavigation(intent);
  },
  blockFrames() {
    window.requestAnimationFrame = (callback) => frames.push(callback);
  },
  flushFrames() {
    window.requestAnimationFrame = requestFrame;
    for (const frame of frames.splice(0)) frame(performance.now());
  },
  snapshot() {
    return {
      commands: [...commands],
      nativePending,
      pending: pendingNotificationNavigation()?.deliveryId,
      blockedFrames: frames.length,
      covered: !cover.hidden,
    };
  },
};

declare global {
  interface Window {
    notificationCoverFixture: typeof fixture;
  }
}
window.notificationCoverFixture = fixture;
