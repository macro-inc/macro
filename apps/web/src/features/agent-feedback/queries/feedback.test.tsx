import { renderHook } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { ParentProps } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { FeedbackSubject } from '../core/subject';
import { createFakeFeedbackClient } from '../tests/fake-client';
import { createResponseFeedbackSource } from './feedback';

const SESSION = 'session-1';

function turn(n: number): FeedbackSubject {
  return { kind: 'agent_session_turn', sessionId: SESSION, turn: n };
}

function setup(fake: ReturnType<typeof createFakeFeedbackClient>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      first: createResponseFeedbackSource(fake.client, turn(1), 'agents_view'),
      second: createResponseFeedbackSource(fake.client, turn(2), 'agents_view'),
    }),
    { wrapper }
  );
  return result;
}

describe('createResponseFeedbackSource', () => {
  it('serves every response in a session from one read', async () => {
    const fake = createFakeFeedbackClient([
      { key: '2', rating: 'down', note: 'wrong repo', updatedAt: 'then' },
    ]);
    const sources = setup(fake);

    await vi.waitFor(() => expect(sources.first.ready()).toBe(true));

    expect(fake.client.mine).toHaveBeenCalledTimes(1);
    expect(fake.client.mine).toHaveBeenCalledWith({
      kind: 'agent_session',
      sessionId: SESSION,
    });
    expect(sources.first.current()).toBeUndefined();
    expect(sources.second.current()?.rating).toBe('down');
  });

  it('shows a rating at once and keeps the server answer', async () => {
    const fake = createFakeFeedbackClient();
    const sources = setup(fake);
    await vi.waitFor(() => expect(sources.first.ready()).toBe(true));

    const write = sources.first.write('id-1', {
      kind: 'rate',
      rating: 'up',
      note: null,
    });
    await vi.waitFor(() => expect(sources.first.current()?.rating).toBe('up'));
    expect(fake.client.rate).toHaveBeenCalledWith(turn(1), {
      id: 'id-1',
      rating: 'up',
      note: null,
      surface: 'agents_view',
    });

    fake.release();
    expect((await write).isOk()).toBe(true);
    expect(sources.first.current()?.updatedAt).toBe('server');
  });

  it('puts back only its own response when a write fails', async () => {
    const fake = createFakeFeedbackClient([
      { key: '1', rating: 'down', note: null, updatedAt: 'then' },
    ]);
    const sources = setup(fake);
    await vi.waitFor(() => expect(sources.first.ready()).toBe(true));

    fake.failNext('FORBIDDEN');
    const failing = sources.first.write('id-1', {
      kind: 'rate',
      rating: 'up',
      note: null,
    });
    const other = sources.second.write('id-2', {
      kind: 'rate',
      rating: 'up',
      note: null,
    });
    await vi.waitFor(() => expect(fake.client.rate).toHaveBeenCalledTimes(2));
    expect(sources.first.current()?.rating).toBe('up');

    fake.release();
    const failed = await failing;
    await other;

    expect(failed.isErr() && failed.error).toBe('forbidden');
    expect(sources.first.current()?.rating).toBe('down');
    expect(sources.second.current()?.rating).toBe('up');
  });

  it('removes a retracted rating, and restores it if the server refuses', async () => {
    const fake = createFakeFeedbackClient([
      { key: '1', rating: 'up', note: 'good', updatedAt: 'then' },
    ]);
    const sources = setup(fake);
    await vi.waitFor(() => expect(sources.first.ready()).toBe(true));

    fake.failNext('NOT_FOUND');
    const refused = sources.first.write('id-1', { kind: 'retract' });
    await vi.waitFor(() => expect(sources.first.current()).toBeUndefined());
    fake.release();
    const result = await refused;
    expect(result.isErr() && result.error).toBe('unavailable');
    expect(sources.first.current()?.note).toBe('good');

    const retract = sources.first.write('id-2', { kind: 'retract' });
    await vi.waitFor(() =>
      expect(fake.client.retract).toHaveBeenCalledTimes(2)
    );
    fake.release();
    expect((await retract).isOk()).toBe(true);
    expect(sources.first.current()).toBeUndefined();
  });
});
