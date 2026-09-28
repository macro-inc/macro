import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createChannelInvites } from './create-channel-invites';

describe('channel invitations', () => {
  it('adds only new, unique recipients and closes after success', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const invitations = createRoot(() =>
      createChannelInvites({
        candidateIds: () => ['existing', 'new', 'new', 'external@example.com'],
        existingIds: () => ['existing'],
        ready: () => true,
        add,
        onClose,
      })
    );
    await invitations.addPeople();
    expect(add).toHaveBeenCalledWith(['new', 'external@example.com']);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('waits for membership data and handles everyone already being present', async () => {
    const add = vi.fn();
    const [ready, setReady] = createSignal(false);
    const [existing, setExisting] = createSignal<string[]>([]);
    const invitations = createRoot(() =>
      createChannelInvites({
        candidateIds: () => ['teammate'],
        existingIds: existing,
        ready,
        add,
        onClose: vi.fn(),
      })
    );
    await invitations.addPeople();
    expect(add).not.toHaveBeenCalled();
    setExisting(['teammate']);
    setReady(true);
    expect(invitations.canAdd()).toBe(false);
    await invitations.addPeople();
    expect(add).not.toHaveBeenCalled();
  });

  it('blocks double submissions and closing while an invitation is pending', async () => {
    let resolve: () => void = () => {};
    const add = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const onClose = vi.fn();
    const invitations = createRoot(() =>
      createChannelInvites({
        candidateIds: () => ['teammate'],
        existingIds: () => [],
        ready: () => true,
        add,
        onClose,
      })
    );
    const submission = invitations.addPeople();
    expect(invitations.pending()).toBe(true);
    await invitations.addPeople();
    invitations.close();
    expect(add).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    resolve();
    await submission;
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps failed invitations available for retry', async () => {
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const invitations = createRoot(() =>
      createChannelInvites({
        candidateIds: () => ['teammate'],
        existingIds: () => [],
        ready: () => true,
        add,
        onClose,
      })
    );
    await invitations.addPeople();
    expect(invitations.error()).toContain('Try again');
    expect(invitations.canAdd()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await invitations.addPeople();
    expect(invitations.error()).toBeUndefined();
    expect(add).toHaveBeenNthCalledWith(2, ['teammate']);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
