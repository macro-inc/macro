import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTauriNotificationInterface,
  MacOSNotificationUpdateRequiredError,
} from './notification';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  osType: vi.fn(() => 'macos'),
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(),
  channels: [] as { onmessage: (event: 'click' | 'dismissed') => void }[],
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: class {
    constructor(public onmessage: (event: 'click' | 'dismissed') => void) {
      mocks.channels.push(this);
    }
  },
}));
vi.mock('@tauri-apps/plugin-os', () => ({ type: mocks.osType }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
  sendNotification: mocks.sendNotification,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const notification = {
  title: 'New message',
  notificationId: '01a1561c-62b1-7ee4-99d5-1fa5988dbf5d',
  options: { body: 'A teammate mentioned you', icon: 'macro-icon.svg' },
};

describe('desktop notification delivery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.channels.length = 0;
    mocks.osType.mockReturnValue('macos');
    mocks.isPermissionGranted.mockResolvedValue(true);
    mocks.requestPermission.mockResolvedValue('granted');
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'get_macos_notification_permission') return 'granted';
    });
  });

  it('sends macOS notifications through the modern native command and awaits acceptance', async () => {
    const acceptance = deferred<void>();
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'get_macos_notification_permission') return 'granted';
      return acceptance.promise;
    });
    const adapter = createTauriNotificationInterface(vi.fn());
    let completed = false;
    async function deliver() {
      const result = await adapter.showNotification(notification);
      completed = true;
      return result;
    }
    const delivery = deliver();

    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('send_macos_notification', {
        title: notification.title,
        body: notification.options.body,
        notificationId: notification.notificationId,
      });
    });
    expect(completed).toBe(false);
    expect(mocks.sendNotification).not.toHaveBeenCalled();

    acceptance.resolve();
    await expect(delivery).resolves.toEqual({
      onClick: expect.any(Function),
      onDismiss: expect.any(Function),
      close: expect.any(Function),
    });
    expect(completed).toBe(true);
  });

  it('supports a title without a body on macOS', async () => {
    const adapter = createTauriNotificationInterface(vi.fn());
    await adapter.showNotification({ title: 'Reminder' });
    expect(mocks.invoke).toHaveBeenCalledWith('send_macos_notification', {
      title: 'Reminder',
      body: undefined,
      notificationId: undefined,
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('titles macOS notifications with the sender and names the conversation beneath', async () => {
    const adapter = createTauriNotificationInterface(vi.fn());
    const sender = {
      id: 'macro|ada@example.com',
      name: 'Ada',
      avatarUrl: 'https://cdn.example.com/ada.png',
    };
    await adapter.showNotification({
      ...notification,
      title: 'Ada <design>',
      sender,
      conversation: { id: 'channel-1', name: 'design' },
    });
    expect(mocks.invoke).toHaveBeenCalledWith('send_macos_notification', {
      title: 'Ada',
      body: notification.options.body,
      notificationId: notification.notificationId,
      subtitle: 'design',
      threadId: 'channel-1',
      sender,
    });
  });

  it('keeps the full title on macOS when nobody can be named', async () => {
    const adapter = createTauriNotificationInterface(vi.fn());
    await adapter.showNotification({
      title: 'Someone <General>',
      conversation: { id: 'channel-1', name: 'General' },
    });
    expect(mocks.invoke).toHaveBeenCalledWith('send_macos_notification', {
      title: 'Someone <General>',
      body: undefined,
      notificationId: undefined,
      subtitle: undefined,
      threadId: 'channel-1',
      sender: undefined,
    });
  });

  it.each(['default', 'denied'])(
    'does not send when macOS permission is %s',
    async (permission) => {
      mocks.invoke.mockResolvedValue(permission);
      const adapter = createTauriNotificationInterface(vi.fn());
      await expect(adapter.showNotification(notification)).resolves.toBe(
        'not-granted'
      );
      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
        'get_macos_notification_permission'
      );
      expect(mocks.sendNotification).not.toHaveBeenCalled();
    }
  );

  it('rechecks the in-app preference after the OS permission read completes', async () => {
    const permission = deferred<NotificationPermission>();
    mocks.invoke.mockReturnValue(permission.promise);
    let enabled = true;
    const adapter = createTauriNotificationInterface(vi.fn(), () => enabled);
    const delivery = adapter.showNotification(notification);
    enabled = false;
    permission.resolve('granted');

    await expect(delivery).resolves.toBe('not-granted');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'get_macos_notification_permission'
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('propagates native delivery failures without using the legacy sender', async () => {
    const failure = new Error('Notifications are not allowed');
    mocks.invoke
      .mockResolvedValueOnce('granted')
      .mockRejectedValueOnce(failure);
    const adapter = createTauriNotificationInterface(vi.fn());

    await expect(adapter.showNotification(notification)).rejects.toBe(failure);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('requires an app update when an older native build has no modern sender', async () => {
    const missingCommand = 'Command send_macos_notification not found';
    mocks.invoke
      .mockResolvedValueOnce('granted')
      .mockRejectedValueOnce(missingCommand);
    const adapter = createTauriNotificationInterface(vi.fn());

    const delivery = adapter.showNotification(notification);
    await expect(delivery).rejects.toBeInstanceOf(
      MacOSNotificationUpdateRequiredError
    );
    await expect(delivery).rejects.toMatchObject({
      message: 'Update Macro to receive desktop notifications.',
      cause: missingCommand,
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('never downgrades macOS delivery when an older build also lacks permission commands', async () => {
    mocks.invoke
      .mockRejectedValueOnce(
        'Command get_macos_notification_permission not found'
      )
      .mockRejectedValueOnce('Command send_macos_notification not found');
    const adapter = createTauriNotificationInterface(vi.fn());

    await expect(adapter.showNotification(notification)).rejects.toThrow(
      'Update Macro to receive desktop notifications.'
    );
    expect(mocks.isPermissionGranted).toHaveBeenCalledOnce();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('does not dispatch when reading macOS authorization fails', async () => {
    const failure = new Error('Permission callback was dropped');
    mocks.invoke.mockRejectedValue(failure);
    const adapter = createTauriNotificationInterface(vi.fn());

    await expect(adapter.showNotification(notification)).rejects.toBe(failure);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'get_macos_notification_permission'
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it.each(['windows', 'ios', 'android'])(
    'preserves plugin delivery on %s',
    async (os) => {
      mocks.osType.mockReturnValue(os);
      const adapter = createTauriNotificationInterface(vi.fn());
      await adapter.showNotification(notification);

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.sendNotification).toHaveBeenCalledExactlyOnceWith({
        title: notification.title,
        body: notification.options.body,
        icon: notification.options.icon,
        extra: {},
      });
    }
  );

  describe('Linux activation', () => {
    beforeEach(() => {
      mocks.osType.mockReturnValue('linux');
      mocks.invoke.mockResolvedValue('native-handle');
    });

    async function show(data = notification) {
      const adapter = createTauriNotificationInterface(vi.fn());
      const handle = await adapter.showNotification(data);
      if (handle === 'not-granted') throw new Error('Expected delivery');
      return handle;
    }

    it('sends an actionable native notification and dispatches its click only once', async () => {
      const handle = await show();
      const clicked = vi.fn();
      const dismissed = vi.fn();
      handle.onClick(clicked);
      handle.onDismiss(dismissed);
      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
        'send_linux_notification',
        {
          ...notification.options,
          title: notification.title,
          onEvent: mocks.channels[0],
        }
      );
      mocks.channels[0].onmessage('click');
      mocks.channels[0].onmessage('click');
      mocks.channels[0].onmessage('dismissed');
      handle.close();
      expect(clicked).toHaveBeenCalledOnce();
      expect(dismissed).not.toHaveBeenCalled();
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
      expect(mocks.sendNotification).not.toHaveBeenCalled();
    });

    it('isolates callback errors from channel cleanup and other listeners', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const handle = await show();
        const failure = new Error('Navigation failed');
        const clicked = vi.fn();
        handle.onClick(() => {
          throw failure;
        });
        handle.onClick(clicked);
        expect(() => mocks.channels[0].onmessage('click')).not.toThrow();
        expect(clicked).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(
          'Linux notification callback failed',
          failure
        );
      } finally {
        log.mockRestore();
      }
    });

    it('keeps simultaneous notifications and their close handles separate', async () => {
      mocks.invoke
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second');
      const first = await show();
      const second = await show();
      const firstClick = vi.fn();
      const secondClick = vi.fn();
      const firstDismiss = vi.fn();
      first.onClick(firstClick);
      first.onDismiss(firstDismiss);
      second.onClick(secondClick);
      first.close();
      first.close();
      expect(mocks.invoke).toHaveBeenLastCalledWith(
        'close_linux_notification',
        { id: 'first' }
      );
      expect(mocks.invoke).toHaveBeenCalledTimes(3);
      mocks.channels[0].onmessage('dismissed');
      mocks.channels[1].onmessage('click');
      expect(firstDismiss).toHaveBeenCalledOnce();
      expect(firstClick).not.toHaveBeenCalled();
      expect(secondClick).toHaveBeenCalledOnce();
    });

    it.each(['click', 'dismissed'] as const)(
      'buffers an early %s until callback registration',
      async (event) => {
        mocks.invoke.mockImplementation(async () => {
          mocks.channels[0].onmessage(event);
          return 'early';
        });
        const handle = await show();
        const clicked = vi.fn();
        const dismissed = vi.fn();
        handle.onClick(clicked);
        handle.onDismiss(dismissed);
        expect(clicked).toHaveBeenCalledTimes(event === 'click' ? 1 : 0);
        expect(dismissed).toHaveBeenCalledTimes(event === 'dismissed' ? 1 : 0);
      }
    );

    it('supports title-only notifications', async () => {
      await createTauriNotificationInterface(vi.fn()).showNotification({
        title: 'Reminder',
      });
      expect(mocks.invoke).toHaveBeenCalledWith('send_linux_notification', {
        title: 'Reminder',
        body: undefined,
        icon: undefined,
        onEvent: mocks.channels[0],
      });
    });

    it('waits for native delivery acceptance', async () => {
      const acceptance = deferred<string>();
      mocks.invoke.mockReturnValue(acceptance.promise);
      let completed = false;
      async function deliver() {
        await show();
        completed = true;
      }
      const delivery = deliver();
      await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
      expect(completed).toBe(false);
      acceptance.resolve('accepted');
      await delivery;
      expect(completed).toBe(true);
    });

    it('honors disabled delivery and denied permission', async () => {
      const disabled = createTauriNotificationInterface(vi.fn(), () => false);
      expect(await disabled.showNotification(notification)).toBe('not-granted');
      mocks.isPermissionGranted.mockResolvedValue(false);
      expect(
        await createTauriNotificationInterface(vi.fn()).showNotification(
          notification
        )
      ).toBe('not-granted');
      expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('uses the error class recognized by AppProviders when native support is missing', async () => {
      const missingCommand = 'Command send_linux_notification not found';
      mocks.invoke.mockRejectedValue(missingCommand);
      const delivery = show();
      // AppProviders imports this class from the existing notification export.
      await expect(delivery).rejects.toBeInstanceOf(
        MacOSNotificationUpdateRequiredError
      );
      await expect(delivery).rejects.toMatchObject({
        message: 'Update Macro to receive desktop notifications.',
        cause: missingCommand,
      });
      expect(mocks.sendNotification).not.toHaveBeenCalled();
    });

    it('propagates D-Bus delivery failures', async () => {
      const failure = new Error('Notification daemon unavailable');
      mocks.invoke.mockRejectedValue(failure);
      await expect(show()).rejects.toBe(failure);
      expect(mocks.sendNotification).not.toHaveBeenCalled();
    });
  });

  it('preserves the title-only plugin call on other platforms', async () => {
    mocks.osType.mockReturnValue('windows');
    const adapter = createTauriNotificationInterface(vi.fn());
    await adapter.showNotification({ title: 'Reminder' });
    expect(mocks.sendNotification).toHaveBeenCalledExactlyOnceWith('Reminder');
  });
});
