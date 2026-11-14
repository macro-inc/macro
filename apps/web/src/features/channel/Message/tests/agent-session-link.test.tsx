/**
 * @vitest-environment jsdom
 */

import type { MessageData } from '@core/messages/types';
import { queryClient } from '@queries/client';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionLink } from '../AgentSessionLink';
import { MessageProvider } from '../context';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    getSessionThreadReplies: vi.fn(),
    setSessionThreadReplies: vi.fn(),
  },
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => undefined,
}));

const toastFailure = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: toastFailure },
}));

afterEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

const reply = {
  id: 'reply',
  content:
    '<m-agent-session-mention>{"id":"session-1"}</m-agent-session-mention>\n\nOn it.',
  sender_id: 'bot|ada',
  created_at: '2026-11-13T00:00:00.000Z',
  updated_at: '2026-11-13T00:00:00.000Z',
  attachments: [],
  reactions: [],
} as unknown as MessageData;

function renderLink() {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <MessageProvider value={() => reply}>
          <AgentSessionLink />
        </MessageProvider>
      </Suspense>
    </QueryClientProvider>
  ));
}

describe('the thread replies toggle beside Open Session', () => {
  it('pauses and resumes the agent in the thread', async () => {
    vi.mocked(
      agentHarnessServiceClient.getSessionThreadReplies
    ).mockResolvedValue(
      ok({ fromThread: true, paused: false, canChange: true })
    );
    vi.mocked(
      agentHarnessServiceClient.setSessionThreadReplies
    ).mockResolvedValue(ok({ paused: true }));
    renderLink();

    const pause = await screen.findByRole('button', {
      name: 'Pause agent replies',
    });
    expect(pause.getAttribute('aria-pressed')).toBe('false');

    vi.mocked(
      agentHarnessServiceClient.getSessionThreadReplies
    ).mockResolvedValue(
      ok({ fromThread: true, paused: true, canChange: true })
    );
    fireEvent.click(pause);

    const resume = await screen.findByRole('button', {
      name: 'Resume agent replies',
    });
    expect(resume.getAttribute('aria-pressed')).toBe('true');
    expect(
      agentHarnessServiceClient.setSessionThreadReplies
    ).toHaveBeenCalledWith('session-1', { paused: true });
    expect(screen.getByRole('button', { name: 'Open Session' })).toBeTruthy();
    expect(toastFailure).not.toHaveBeenCalled();
  });

  it('rolls back and says so when the change fails', async () => {
    vi.mocked(
      agentHarnessServiceClient.getSessionThreadReplies
    ).mockResolvedValue(
      ok({ fromThread: true, paused: false, canChange: true })
    );
    vi.mocked(
      agentHarnessServiceClient.setSessionThreadReplies
    ).mockResolvedValue(err([{ code: 'HTTP_ERROR', message: 'nope' }]));
    renderLink();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Pause agent replies' })
    );

    await waitFor(() => expect(toastFailure).toHaveBeenCalled());
    expect(
      await screen.findByRole('button', { name: 'Pause agent replies' })
    ).toBeTruthy();
  });

  it('is absent for someone who cannot change it', async () => {
    vi.mocked(
      agentHarnessServiceClient.getSessionThreadReplies
    ).mockResolvedValue(
      ok({ fromThread: true, paused: false, canChange: false })
    );
    renderLink();

    await screen.findByRole('button', { name: 'Open Session' });
    await waitFor(() =>
      expect(
        agentHarnessServiceClient.getSessionThreadReplies
      ).toHaveBeenCalled()
    );
    expect(screen.queryByRole('button', { name: /agent replies/ })).toBeNull();
  });
});
