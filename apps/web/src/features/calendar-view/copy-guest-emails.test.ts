import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyGuestEmails } from './copy-guest-emails';

const writeClipboardData = vi.hoisted(() =>
  vi.fn(async (_data: Record<string, string | undefined>) => true)
);
const toast = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));

vi.mock('@core/util/dataTransfer', () => ({ writeClipboardData }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

describe('copyGuestEmails', () => {
  beforeEach(() => {
    writeClipboardData.mockClear();
    toast.success.mockClear();
    toast.failure.mockClear();
  });

  it('writes the addresses comma-separated as plain text', async () => {
    await copyGuestEmails(['daniel@example.com', 'teo@example.com']);

    expect(writeClipboardData).toHaveBeenCalledWith({
      'text/plain': 'daniel@example.com, teo@example.com',
    });
    expect(toast.success).toHaveBeenCalledWith('Copied guest emails');
  });

  it('reports a clipboard that refused the write', async () => {
    writeClipboardData.mockResolvedValueOnce(false);

    await copyGuestEmails(['daniel@example.com']);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.failure).toHaveBeenCalledWith('Failed to copy guest emails');
  });
});
