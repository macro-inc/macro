import type { QueuedActionDto } from '@service-agent-harness/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import { createSteer } from './steer';

const waiting: QueuedActionDto = {
  actionId: 'later',
  kind: 'prompt',
  prompt: 'Steer this',
  attachments: [],
  actorUserId: null,
  createdAt: '2026-10-02T00:00:00Z',
};

describe('createSteer', () => {
  it('shows the chosen prompt as sent and takes it back when the server refuses', async () => {
    const expectAction = vi.fn();
    const retract = vi.fn();
    const steer = vi.fn(async () => false);
    const send = createSteer({
      currentTurn: () => 'running',
      entries: () => [waiting],
      steer,
      expect: expectAction,
      retract,
    });

    send('later');

    expect(expectAction).toHaveBeenCalledWith('later', {
      type: 'prompt',
      prompt: 'Steer this',
    });
    await vi.waitFor(() => expect(retract).toHaveBeenCalledWith('later'));
  });

  it('does not jump another entry while a steer is still unconfirmed', () => {
    const expectAction = vi.fn();
    const steer = vi.fn(async () => true);
    const send = createSteer({
      currentTurn: () => 'starting',
      entries: () => [waiting],
      steer,
      expect: expectAction,
      retract: vi.fn(),
    });

    send('later');

    expect(expectAction).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
  });
});
