import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MetadataEvent = {
  kind: 'metadata';
  metadata: { pendingInteractions: unknown[] };
};
const fake = vi.hoisted(() => ({
  trackEntity: vi.fn(async () => {}),
  load: vi.fn(async () => ({ session: { canEdit: true } })),
  snapshot: vi.fn(async () => ({
    metadata: { pendingInteractions: [] as unknown[] },
  })),
  release: vi.fn(),
  unsubscribe: vi.fn(),
  listener: undefined as ((events: MetadataEvent[]) => void) | undefined,
}));
vi.mock('@service-connection/client', () => ({
  connectionGatewayClient: { trackEntity: fake.trackEntity },
}));
vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: {
    acquire: () => ({
      load: fake.load,
      snapshot: fake.snapshot,
      release: fake.release,
      subscribe: (listener: typeof fake.listener) => {
        fake.listener = listener;
        return fake.unsubscribe;
      },
    }),
  },
}));
import { observeVoiceSession } from './session-observer';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.load.mockResolvedValue({ session: { canEdit: true } });
  fake.snapshot.mockResolvedValue({ metadata: { pendingInteractions: [] } });
});
afterEach(() => vi.useRealTimers());

describe('canonical voice session observer', () => {
  it('keeps the canonical session subscribed in the background and releases it once', async () => {
    const review = vi.fn();
    const observer = await observeVoiceSession('session', review);
    expect(fake.trackEntity).toHaveBeenCalledWith({
      entity_type: 'agent_session',
      entity_id: 'session',
      action: 'open',
    });
    expect(review).toHaveBeenLastCalledWith(false);
    fake.listener?.([
      { kind: 'metadata', metadata: { pendingInteractions: [{}] } },
    ]);
    expect(review).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.trackEntity).toHaveBeenLastCalledWith({
      entity_type: 'agent_session',
      entity_id: 'session',
      action: 'ping',
    });
    observer.close();
    observer.close();
    expect(fake.release).toHaveBeenCalledOnce();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    expect(fake.trackEntity).toHaveBeenLastCalledWith({
      entity_type: 'agent_session',
      entity_id: 'session',
      action: 'close',
    });
    const calls = fake.trackEntity.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    fake.listener?.([
      { kind: 'metadata', metadata: { pendingInteractions: [] } },
    ]);
    expect(fake.trackEntity).toHaveBeenCalledTimes(calls);
    expect(review).toHaveBeenLastCalledWith(true);
  });

  it('does not overwrite a live review request with a stale initial snapshot', async () => {
    fake.snapshot.mockImplementationOnce(async () => {
      fake.listener?.([
        { kind: 'metadata', metadata: { pendingInteractions: [{}] } },
      ]);
      return { metadata: { pendingInteractions: [] } };
    });
    const review = vi.fn();
    const observer = await observeVoiceSession('session', review);
    expect(review).toHaveBeenCalledExactlyOnceWith(true);
    observer.close();
  });

  it.each(['permission', 'load', 'snapshot'])(
    'releases subscription when %s fails',
    async (failure) => {
      if (failure === 'permission')
        fake.load.mockResolvedValueOnce({ session: { canEdit: false } });
      if (failure === 'load')
        fake.load.mockRejectedValueOnce(new Error('Load failed'));
      if (failure === 'snapshot')
        fake.snapshot.mockRejectedValueOnce(new Error('Snapshot failed'));
      await expect(observeVoiceSession('session', vi.fn())).rejects.toThrow();
      expect(fake.release).toHaveBeenCalledOnce();
      expect(fake.unsubscribe).toHaveBeenCalledOnce();
      expect(fake.trackEntity).toHaveBeenLastCalledWith({
        entity_type: 'agent_session',
        entity_id: 'session',
        action: 'close',
      });
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
