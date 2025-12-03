import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@notifications', () => ({}));
vi.mock('@solidjs/router', () => ({}));

vi.mock('../src/notification-helpers', () => ({
  isHighPriorityNotification: vi.fn(),
  generateDeepLinkUrl: vi.fn(),
}));

import {
  createTauriNotificationInterface,
  sanitizeNotificationPayload,
} from '../src/notification';
import {
  isPermissionGranted,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  generateDeepLinkUrl,
  isHighPriorityNotification,
} from '../src/notification-helpers';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

const mockIsPermissionGranted = isPermissionGranted as unknown as Mock<
  () => Promise<boolean>
>;
const mockSendNotification = sendNotification as unknown as Mock<
  (args: Record<string, unknown>) => Promise<void>
>;
const mockIsHighPriorityNotification =
  isHighPriorityNotification as unknown as Mock<
    (payload: Record<string, unknown>) => boolean
  >;
const mockGenerateDeepLinkUrl = generateDeepLinkUrl as unknown as Mock<
  (payload: Record<string, unknown>) => string | null
>;

type TestNotificationOptions = NotificationOptions & { data?: unknown };
interface TestPlatformNotificationData {
  title: string;
  options?: TestNotificationOptions;
}

describe('createTauriNotificationInterface.showNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPermissionGranted.mockResolvedValue(true);
    mockSendNotification.mockResolvedValue(undefined);
    mockGenerateDeepLinkUrl.mockReturnValue(null);
  });

  it('dispatches low-priority payload notifications with sanitized payload data', async () => {
    mockIsHighPriorityNotification.mockReturnValue(false);
    const tauriInterface = createTauriNotificationInterface(async () => {});
    const payload = {
      notificationEventType: 'channel_message_send',
      notificationMetadata: { channelType: 'channel' },
      eventItemId: 'channel-123',
    };

    const data: TestPlatformNotificationData = {
      title: 'Low Priority Message',
      options: {
        body: 'Body',
        icon: 'icon.png',
        data: payload,
      },
    };

    await tauriInterface.showNotification(data);

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const [args] = mockSendNotification.mock.calls[0];
    expect(args).toMatchObject({
      title: 'Low Priority Message',
      extra: {
        payload,
      },
    });
    expect(args.extra?.payload).not.toBe(payload);
  });

  it('dispatches deep-link data for high-priority notifications', async () => {
    mockIsHighPriorityNotification.mockReturnValue(true);
    mockGenerateDeepLinkUrl.mockReturnValue('macro://deep-link');

    const tauriInterface = createTauriNotificationInterface(async () => {});
    const payload = {
      notificationEventType: 'channel_mention',
      eventItemId: 'channel-456',
      notificationMetadata: {
        messageId: 'msg-1',
        threadId: 'thread-1',
      },
    };

    const data: TestPlatformNotificationData = {
      title: 'Mention',
      options: {
        body: 'Mention Body',
        icon: 'mention.png',
        data: payload,
      },
    };

    await tauriInterface.showNotification(data);

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const [args] = mockSendNotification.mock.calls[0];
    expect(args.extra?.deepLinkUrl).toBe('macro://deep-link');
    expect(args.extra?.payload).toBeUndefined();
  });
});

describe('sanitizeNotificationPayload', () => {
  it('returns a deep-cloned payload when serialization succeeds', () => {
    const payload = {
      notificationEventType: 'channel_message_send',
      notificationMetadata: { channelType: 'channel' },
      eventItemId: 'channel-789',
    };

    const sanitized = sanitizeNotificationPayload(payload as never);

    expect(sanitized).toEqual(payload);
    expect(sanitized).not.toBe(payload);
  });

  it('returns undefined when serialization fails', () => {
    const circular: Record<string, unknown> & { self?: unknown } = {
      notificationEventType: 'channel_message_send',
      notificationMetadata: {},
      eventItemId: 'channel-101',
    };
    circular.self = circular;

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const sanitized = sanitizeNotificationPayload(circular as never);

    expect(sanitized).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
