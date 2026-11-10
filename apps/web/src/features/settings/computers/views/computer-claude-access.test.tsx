// @vitest-environment jsdom

import { ThrownResultError } from '@core/util/result';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { ComputerClaudeAccess } from './computer-claude-access';

const mocks = vi.hoisted(() => ({
  enabled: true,
  mode: 'macro_credits',
  start: vi.fn(async () => ({ url: 'https://claude.ai/oauth/authorize' })),
  complete: vi.fn(
    async (_vars: {
      harnessId: string;
      code: string;
      signal: AbortSignal;
    }) => ({ signedIn: true })
  ),
  open: vi.fn(),
  cancel: vi.fn(async (_harnessId: string) => undefined),
  pendingStart: (): boolean => false,
  pendingComplete: (): boolean => false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled, loading: false }),
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: mocks.open }));
vi.mock('@queries/computers/claude', () => ({
  useClaudeModeQuery: () => ({
    isSuccess: true,
    data: { mode: mocks.mode },
    isError: false,
  }),
  useClaudeSignInMutation: () => ({
    mutateAsync: mocks.start,
    get isPending() {
      return mocks.pendingStart();
    },
  }),
  useClaudeCompleteMutation: () => ({
    mutateAsync: mocks.complete,
    get isPending() {
      return mocks.pendingComplete();
    },
  }),
  useClaudeCancelMutation: () => ({
    mutateAsync: mocks.cancel,
    isPending: false,
  }),
  useClaudeSignOutMutation: () => ({ isPending: false }),
}));

beforeEach(() => {
  mocks.enabled = true;
  mocks.mode = 'macro_credits';
  vi.clearAllMocks();
  mocks.pendingStart = () => false;
  mocks.pendingComplete = () => false;
});

it('opens Claude and submits the trimmed code or callback URL', async () => {
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  const input = await screen.findByLabelText(
    'Paste the code Claude showed you'
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
      signal: expect.any(AbortSignal),
    })
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Paste the code Claude showed you')
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

it('explains a rejected code and lets the user start again', async () => {
  mocks.complete.mockRejectedValueOnce(
    new ThrownResultError([
      { code: 'CLAUDE_INVALID_CODE', message: 'rejected' },
    ])
  );
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  const input = await screen.findByLabelText(
    'Paste the code Claude showed you'
  );
  fireEvent.input(input, { target: { value: 'bad-code' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      "That code didn't work — sign in again to get a new one"
    )
  );
  expect(
    screen.queryByLabelText('Paste the code Claude showed you')
  ).toBeNull();
});

it('explains a conflicting sign-in instead of showing a generic failure', async () => {
  mocks.start.mockRejectedValueOnce(
    new ThrownResultError([{ code: 'CONFLICT', message: 'Resource conflict' }])
  );
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'Another sign-in is in progress on this computer — try again shortly'
    )
  );
});

it('disables starting another sign-in until the paste form is cancelled', async () => {
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  const start = screen.getByRole('button', { name: 'Sign in with Claude' });
  fireEvent.click(start);
  await screen.findByLabelText('Paste the code Claude showed you');
  expect(start).toHaveProperty('disabled', true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Skip, use Macro credits' })
  );
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('computer'));
  await waitFor(() => expect(start).not.toHaveProperty('disabled', true));
  expect(
    screen.queryByLabelText('Paste the code Claude showed you')
  ).toBeNull();
});

it('disables sign-in while start awaits its URL', async () => {
  const [pending, setPending] = createSignal(false);
  mocks.pendingStart = pending;
  const started = Promise.withResolvers<{ url: string }>();
  mocks.start.mockImplementationOnce(async () => {
    setPending(true);
    try {
      return await started.promise;
    } finally {
      setPending(false);
    }
  });
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  const start = screen.getByRole('button', { name: 'Sign in with Claude' });
  fireEvent.click(start);
  expect(start).toHaveProperty('disabled', true);
  started.resolve({ url: 'https://claude.ai/oauth/authorize' });
  await screen.findByLabelText('Paste the code Claude showed you');
});

it('can cancel a pending submit and ignores its late result', async () => {
  const [pending, setPending] = createSignal(false);
  mocks.pendingComplete = pending;
  const completed = Promise.withResolvers<{ signedIn: boolean }>();
  mocks.complete.mockImplementationOnce(async () => {
    setPending(true);
    try {
      return await completed.promise;
    } finally {
      setPending(false);
    }
  });
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  const input = await screen.findByLabelText(
    'Paste the code Claude showed you'
  );
  fireEvent.input(input, { target: { value: 'test-code' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));
  expect(
    screen.getByRole('button', { name: 'Sign in with Claude' })
  ).toHaveProperty('disabled', true);
  const cancel = screen.getByRole('button', {
    name: 'Skip, use Macro credits',
  });
  expect(cancel).not.toHaveProperty('disabled', true);
  fireEvent.click(cancel);
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('computer'));
  completed.resolve({ signedIn: true });
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Paste the code Claude showed you')
    ).toBeNull()
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('aborts and cancels a submitted sign-in when its controls unmount', async () => {
  const submitted = Promise.withResolvers<{ signedIn: boolean }>();
  mocks.complete.mockImplementationOnce(() => submitted.promise);
  const view = render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  const input = await screen.findByLabelText(
    'Paste the code Claude showed you'
  );
  fireEvent.input(input, { target: { value: 'test-code' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));
  const signal = mocks.complete.mock.lastCall?.[0].signal;
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(mocks.cancel).toHaveBeenCalledWith('computer');
  submitted.resolve({ signedIn: true });
});

it('names the connected account and offers Macro credits instead', () => {
  mocks.mode = 'own_account';
  render(() => (
    <ComputerClaudeAccess
      harnessId="computer"
      canManage
      mode="own_account"
      account="team@example.com"
    />
  ));
  expect(screen.getByText('Connected as team@example.com')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Use Macro credits' })
  ).toBeTruthy();
});

it('tells the signer the whole team shares the account and lets them skip', async () => {
  render(() => (
    <ComputerClaudeAccess harnessId="computer" canManage mode="macro_credits" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
  expect(
    await screen.findByText(
      'Everyone on the team uses this Claude account on this computer.'
    )
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Skip, use Macro credits' })
  );
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('computer'));
});
