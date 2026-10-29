import {
  finishNotificationNavigation,
  pendingNotificationNavigation,
  receiveNotificationTap,
} from '@notifications/notification-navigation-intent';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createRoot } from 'solid-js';
import { useNotificationCoverTimeout } from '../notification-launch';
import { createPushApi } from '../push-api';

const COVER = document.getElementById('cover');
const NAVIGATE = document.getElementById('navigate');
const NAVIGATION = document.getElementById('navigation');
if (!COVER || !NAVIGATE || !NAVIGATION) throw new Error('Missing fixture UI');

const COMMANDS: string[] = [];
let nativePending: string | undefined;
const FRAMES: FrameRequestCallback[] = [];
const requestFrame = window.requestAnimationFrame;
window.__MACRO_IOS_NOTIFICATION_LAUNCH__ = true;
mockIPC((command, payload) => {
  COMMANDS.push(command);
  if (command === 'plugin:notifications|release_notification_cover') {
    COVER.hidden = true;
    return;
  }
  if (command === 'plugin:notifications|acknowledge_notification') {
    if (
      payload &&
      'deliveryId' in payload &&
      payload.deliveryId === nativePending
    ) {
      nativePending = undefined;
      COVER.hidden = true;
    }
    return;
  }
  throw new Error(`Unexpected native command: ${command}`);
});

const PUSH = createPushApi('ios');
const dispose = createRoot((dispose) => {
  useNotificationCoverTimeout();
  return dispose;
});
window.addEventListener('pagehide', dispose, { once: true });
NAVIGATE.addEventListener('click', () => {
  NAVIGATION.textContent = 'Another page';
});

const FIXTURE = {
  tap(deliveryId: string) {
    nativePending = deliveryId;
    COVER.hidden = false;
    receiveNotificationTap(
      {
        type: 'BACKGROUND_TAP',
        payload: { notificationId: deliveryId },
        deliveryId,
      },
      PUSH.acknowledge
    );
  },
  complete() {
    const intent = pendingNotificationNavigation();
    if (intent) finishNotificationNavigation(intent);
  },
  blockFrames() {
    window.requestAnimationFrame = (callback) => FRAMES.push(callback);
  },
  flushFrames() {
    window.requestAnimationFrame = requestFrame;
    for (const frame of FRAMES.splice(0)) frame(performance.now());
  },
  snapshot() {
    return {
      commands: [...COMMANDS],
      nativePending,
      pending: pendingNotificationNavigation()?.deliveryId,
      blockedFrames: FRAMES.length,
      covered: !COVER.hidden,
    };
  },
};

declare global {
  interface Window {
    notificationCoverFixture: typeof FIXTURE;
  }
}
window.notificationCoverFixture = FIXTURE;
