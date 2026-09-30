import { describe, expect, it, vi } from 'vitest';
import { createNativeShareSend } from './createNativeShareSend';

describe('native share sending', () => {
  it('joins repeated sends while posting and awaiting native acknowledgement', async () => {
    const posted = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    const post = vi.fn(() => posted.promise);
    const clear = vi.fn(() => acknowledged.promise);
    const share = createNativeShareSend({ send: post, clear });

    const first = share.send('draft');
    expect(share.canSend()).toBe(false);
    expect(share.send('second tap')).toBe(first);
    expect(post).toHaveBeenCalledTimes(1);
    posted.resolve();
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    expect(share.send('tap during cleanup')).toBe(first);
    expect(share.canSend()).toBe(false);
    acknowledged.resolve();
    await first;

    await share.send('tap after cleanup');
    expect(post).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(share.canSend()).toBe(false);
  });

  it('keeps a delivered batch locked when native acknowledgement fails', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const share = createNativeShareSend({
      send: post,
      clear: vi.fn().mockRejectedValue(new Error('Unable to clear')),
    });
    await expect(share.send('draft')).rejects.toThrow('Unable to clear');
    expect(share.canSend()).toBe(false);
    await share.send('second tap');
    expect(post).toHaveBeenCalledOnce();
  });

  it('allows a failed send to be retried without clearing its batch', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const share = createNativeShareSend({ send: post, clear });
    await expect(share.send('draft')).rejects.toThrow('Offline');
    expect(share.canSend()).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    await share.send('draft');
    expect(post).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledOnce();
  });
});
