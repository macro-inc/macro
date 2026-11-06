import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, DEV } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const flagMock = vi.hoisted(() => ({
  read: () => ({ enabled: true, loading: false }),
}));
const portraitMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  generate: vi.fn(),
}));
const [flag, setFlag] = createSignal({ enabled: true, loading: false });
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => flagMock.read(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  portraitMocks.upload.mockResolvedValue(
    'https://example.com/uploaded-portrait.png'
  );
  portraitMocks.generate.mockResolvedValue(
    'https://example.com/generated-portrait.png'
  );
  setFlag({ enabled: true, loading: false });
  flagMock.read = flag;
});

vi.mock('@queries/agents/avatar', () => ({
  generateAgentAvatar: portraitMocks.generate,
  useUploadAgentAvatarMutation: () => ({ mutateAsync: portraitMocks.upload }),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    getTeamAgentSizes: vi.fn(),
    quoteTeamAgent: vi.fn(),
  },
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { voices: vi.fn() },
}));

import { queryClient } from '@queries/client';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { authServiceClient } from '@service-auth/client';
import { InviteAgentDialog } from './invite-agent-dialog';

const quote = {
  included: false,
  seat: 2000,
  computer: 3000,
  total: 5000,
  currency: 'usd',
  vcpus: 4,
  memoryGb: 8,
  diskGb: 100,
  interval: 'month' as const,
};

beforeEach(() => {
  vi.mocked(agentHarnessServiceClient.voices).mockResolvedValue(
    ok([
      {
        model: 'aura-2-arcas-en',
        name: 'Arcas',
        accent: 'American',
        languages: ['en'],
        tags: ['male', 'confident'],
      },
    ])
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps a cold invitation pending until rollout resolves, then loads it only when enabled', async () => {
  setFlag({ enabled: false, loading: true });
  const close = vi.fn();
  vi.mocked(authServiceClient.getTeamAgentSizes).mockResolvedValue(
    ok({ sizes: [] })
  );
  vi.mocked(authServiceClient.quoteTeamAgent).mockResolvedValue(ok(quote));
  render(() => (
    <QueryClientProvider client={queryClient}>
      <InviteAgentDialog teamId="team-1" open onClose={close} />
    </QueryClientProvider>
  ));
  expect(screen.getByRole('status').textContent).toContain(
    'Loading agent features'
  );
  expect(authServiceClient.getTeamAgentSizes).not.toHaveBeenCalled();
  expect(authServiceClient.quoteTeamAgent).not.toHaveBeenCalled();
  expect(agentHarnessServiceClient.voices).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  setFlag({ enabled: true, loading: false });
  await screen.findByRole('dialog');
  expect(authServiceClient.getTeamAgentSizes).toHaveBeenCalledTimes(1);
  expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledTimes(3);
  expect(agentHarnessServiceClient.voices).toHaveBeenCalledTimes(1);
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(close).not.toHaveBeenCalled();
});

it('does not load an invitation when the rollout resolves off', () => {
  setFlag({ enabled: false, loading: true });
  render(() => (
    <QueryClientProvider client={queryClient}>
      <InviteAgentDialog teamId="team-1" open onClose={() => {}} />
    </QueryClientProvider>
  ));
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(authServiceClient.getTeamAgentSizes).not.toHaveBeenCalled();
  expect(authServiceClient.quoteTeamAgent).not.toHaveBeenCalled();
});

it('bounds reactive updates while typing with quotes loaded for all sizes', async () => {
  queryClient.clear();
  vi.mocked(authServiceClient.getTeamAgentSizes).mockResolvedValue(
    ok({
      sizes: [
        { size: 'standard', vcpus: 4, memoryGb: 8, diskGb: 100 },
        { size: 'large', vcpus: 8, memoryGb: 16, diskGb: 200 },
        { size: 'xl', vcpus: 16, memoryGb: 32, diskGb: 400 },
      ],
    })
  );
  vi.mocked(authServiceClient.quoteTeamAgent).mockResolvedValue(ok(quote));
  render(() => (
    <QueryClientProvider client={queryClient}>
      <InviteAgentDialog teamId="team-1" open onClose={() => {}} />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(screen.getByText('100 GiB disk')).toBeTruthy());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));

  const updates = vi.fn();
  if (!DEV) throw new Error('Solid development hooks are required');
  const previousUpdate = DEV.hooks.afterUpdate;
  DEV.hooks.afterUpdate = updates;
  const dialog = screen.getByRole('dialog');
  const fields = [
    screen.getByLabelText('Name'),
    screen.getByLabelText('Role / job description'),
    screen.getByLabelText('Personality'),
  ];
  let queryUpdates = 0;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated') queryUpdates++;
  });
  try {
    for (const field of fields) {
      for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
        fireEvent.input(field, { target: { value } });
        expect(field.isConnected).toBe(true);
      }
    }
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(updates.mock.calls.length).toBeLessThanOrEqual(100);
    expect(queryUpdates).toBe(0);
    expect(agentHarnessServiceClient.voices).toHaveBeenCalledTimes(1);
    expect(authServiceClient.getTeamAgentSizes).toHaveBeenCalledTimes(1);
    expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('radio', { name: /large/i }));
    await waitFor(() =>
      expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledTimes(4)
    );
    expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledWith('large');
    expect(authServiceClient.getTeamAgentSizes).toHaveBeenCalledTimes(1);
  } finally {
    DEV.hooks.afterUpdate = previousUpdate;
    unsubscribe();
  }
});
