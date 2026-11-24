import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingReplies } from './pending-replies';

describe('createPendingReplies', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles each request with its reply, or undefined when the frame never answers', async () => {
    const replies = createPendingReplies<string>(500);
    const sent: number[] = [];

    const answered = replies.request((id) => sent.push(id));
    const ignored = replies.request((id) => sent.push(id));
    expect(sent).toEqual([1, 2]);

    expect(replies.settle(1, 'pixels')).toBe(true);
    await expect(answered).resolves.toBe('pixels');

    await vi.advanceTimersByTimeAsync(500);
    await expect(ignored).resolves.toBeUndefined();
    // Its late reply is refused, so the caller can free it.
    expect(replies.settle(2, 'late pixels')).toBe(false);

    const open = replies.request(() => {});
    replies.settleAll();
    await expect(open).resolves.toBeUndefined();
  });
});
