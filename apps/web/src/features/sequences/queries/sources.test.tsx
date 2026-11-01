import type { EnrollmentSummary } from '@service-email/generated/schemas';
import { render } from '@solidjs/testing-library';
import { type QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnrollmentCommands } from '../context/sequences-context';
import { createEnrollmentCommands } from './sources';

const fake = vi.hoisted(() => ({
  client: undefined as unknown as QueryClient,
  /** Answers the request for an enrollment, which stays open until then. */
  answer: new Map<string, () => void>(),
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  fake.client = new QueryClient();
  return { queryClient: fake.client };
});
vi.mock('@service-email/client', () => ({
  emailClient: {
    updateEnrollment: (id: string) =>
      new Promise((resolve) =>
        fake.answer.set(id, () =>
          resolve(ok({ ...enrollment(id), status: 'paused' }))
        )
      ),
  },
}));

function enrollment(id: string): EnrollmentSummary {
  return {
    id,
    email: `${id}@example.com`,
    status: 'active',
    nextStep: 1,
    stepCount: 2,
    createdAt: '2026-11-01T00:00:00Z',
  };
}

function mount() {
  let commands: EnrollmentCommands | undefined;
  function Probe() {
    commands = createEnrollmentCommands(() => 'sequence');
    return null;
  }
  render(() => (
    <QueryClientProvider client={fake.client}>
      <Probe />
    </QueryClientProvider>
  ));
  if (!commands) throw new Error('commands did not mount');
  return commands;
}

afterEach(() => {
  fake.answer.clear();
  fake.client.clear();
});

describe('createEnrollmentCommands', () => {
  it('keeps each row busy until its own request settles', async () => {
    const commands = mount();
    const first = commands.run(enrollment('a'), 'pause');
    const second = commands.run(enrollment('b'), 'pause');
    await vi.waitFor(() => expect(fake.answer.size).toBe(2));
    expect(commands.pending('a')).toBe(true);
    expect(commands.pending('b')).toBe(true);

    fake.answer.get('b')?.();
    expect((await second).isOk()).toBe(true);
    await vi.waitFor(() => expect(commands.pending('b')).toBe(false));
    expect(commands.pending('a')).toBe(true);

    fake.answer.get('a')?.();
    expect((await first).isOk()).toBe(true);
    await vi.waitFor(() => expect(commands.pending('a')).toBe(false));
  });
});
