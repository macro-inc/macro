// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, expect, it, vi } from 'vitest';
import { ComputerClaudeAccess } from './computer-claude-access';

const mocks = vi.hoisted(() => ({
  enabled: true,
  start: vi.fn(async () => ({ url: 'https://claude.ai/oauth/authorize' })),
  complete: vi.fn(async () => ({ signedIn: true })),
  open: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled, loading: false }),
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: mocks.open }));
vi.mock('@queries/computers/claude', () => ({
  useClaudeModeQuery: () => ({
    isSuccess: true,
    data: { mode: 'macro_credits' },
    isError: false,
  }),
  useClaudeSignInMutation: () => ({
    mutateAsync: mocks.start,
    isPending: false,
  }),
  useClaudeCompleteMutation: () => ({
    mutateAsync: mocks.complete,
    isPending: false,
  }),
  useClaudeSignOutMutation: () => ({ isPending: false }),
}));

beforeEach(() => {
  mocks.enabled = true;
  vi.clearAllMocks();
});

it('opens Claude and submits the trimmed code or callback URL', async () => {
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  const input = await screen.findByLabelText(
    'Paste the code or the URL you were sent to'
  );
  expect(mocks.open).toHaveBeenCalledWith('https://claude.ai/oauth/authorize');
  fireEvent.input(input, {
    target: { value: '  http://localhost:1234/callback?code=example-code  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));
  await waitFor(() =>
    expect(mocks.complete).toHaveBeenCalledWith({
      harnessId: 'computer',
      code: 'http://localhost:1234/callback?code=example-code',
    })
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Paste the code or the URL you were sent to')
    ).toBeNull()
  );
});

it('hides Claude account controls with rollout off', () => {
  mocks.enabled = false;
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  expect(
    screen.queryByRole('button', { name: 'Sign in with Claude' })
  ).toBeNull();
});
