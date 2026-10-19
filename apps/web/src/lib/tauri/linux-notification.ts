import { fireAndForget } from '@core/util/fireAndForget';
import { Channel, invoke } from '@tauri-apps/api/core';
import { MacOSNotificationUpdateRequiredError } from './notification-errors';

type NotificationEvent = 'click' | 'dismissed';

function dispatch(callback: () => void) {
  try {
    callback();
  } catch (error) {
    // Do not let a navigation error interrupt Tauri's channel-end bookkeeping.
    console.error('Linux notification callback failed', error);
  }
}

export async function showLinuxNotification(
  title: string,
  options?: Pick<NotificationOptions, 'body' | 'icon'>
) {
  const clicks: (() => void)[] = [];
  const dismissals: (() => void)[] = [];
  let finished: NotificationEvent | undefined;
  const events = new Channel<NotificationEvent>((event) => {
    if (finished) return;
    finished = event;
    const callbacks = event === 'click' ? clicks : dismissals;
    for (const callback of callbacks) dispatch(callback);
    clicks.length = 0;
    dismissals.length = 0;
  });
  let id: string;
  try {
    id = await invoke<string>('send_linux_notification', {
      title,
      body: options?.body,
      icon: options?.icon,
      onEvent: events,
    });
  } catch (error) {
    if (error === 'Command send_linux_notification not found') {
      throw new MacOSNotificationUpdateRequiredError(error);
    }
    throw error;
  }

  let closing = false;
  async function close() {
    if (finished || closing) return;
    closing = true;
    try {
      await invoke('close_linux_notification', { id });
    } catch (error) {
      closing = false;
      console.error('Failed to close Linux notification', error);
    }
  }

  return {
    onClick(callback: () => void) {
      // The daemon can deliver a click before the command returns, or before
      // the caller has registered its navigation callback. Replay it once.
      if (finished === 'click') dispatch(callback);
      else if (!finished) clicks.push(callback);
    },
    onDismiss(callback: () => void) {
      if (finished === 'dismissed') dispatch(callback);
      else if (!finished) dismissals.push(callback);
    },
    close() {
      fireAndForget(close(), 'linux-notification');
    },
  };
}
