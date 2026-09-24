import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentChangesProvider,
  ChangesHandoff,
  ChangesToggle,
} from './agent-changes';
import {
  createMockAgentChangesContext,
  mockChangeset,
} from './tests/mock-context';

const [session, setSession] = createSignal<AgentSessionResponse>();
const [queuedMessages, setQueuedMessages] = createSignal<
  Array<{ actionId: string; kind: string; prompt: string }>
>([]);
/** Every session id the changes source was asked to read, in order. */
const sourceSessionIds: Array<string | undefined> = [];

vi.mock('../block-agent/context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    userId: () => 'user-1',
    sessionId: () => 'session-1',
    session,
    queue: { entries: queuedMessages },
    loadFailed: () => false,
    issue: async () => undefined,
  }),
}));

vi.mock('./queries/session-changes', () => ({
  createSessionChangesSource: (sessionId: () => string | undefined) => {
    const context = createMockAgentChangesContext({
      summary: { capturing: false, changeset: mockChangeset() },
    });
    return {
      ...context.source,
      summary: () => {
        sourceSessionIds.push(sessionId());
        return sessionId() ? context.source.summary() : undefined;
      },
    };
  },
}));

vi.mock('./queries/pull-request-stats', () => ({
  createPullRequestStatsSource: () => () => undefined,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success() {}, failure() {} },
}));
vi.mock('@core/util/url', () => ({ openExternalUrl() {} }));

function sessionWith(fields: {
  harness: string;
  pullRequestUrl: string | null;
}): AgentSessionResponse {
  return fields as unknown as AgentSessionResponse;
}

describe('AgentChangesProvider', () => {
  it('hides the Changes controls until the coding session links a pull request', () => {
    setSession(sessionWith({ harness: 'cursor', pullRequestUrl: null }));
    sourceSessionIds.length = 0;
    render(() => (
      <AgentChangesProvider>
        <ChangesToggle />
        <ChangesHandoff />
      </AgentChangesProvider>
    ));
    expect(screen.queryByRole('button', { name: /Changes/ })).toBeNull();
    expect(screen.queryByText('Changes ready to review')).toBeNull();
    // Nothing is fetched while there is no pull request to capture from.
    expect(sourceSessionIds.every((id) => id === undefined)).toBe(true);

    setSession(
      sessionWith({
        harness: 'cursor',
        pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
      })
    );
    expect(screen.getByRole('button', { name: /Changes/ })).toBeTruthy();
    expect(screen.getByText('Changes ready to review')).toBeTruthy();
    expect(sourceSessionIds.at(-1)).toBe('session-1');

    setQueuedMessages([
      { actionId: 'queued-1', kind: 'prompt', prompt: 'Update the tests' },
    ]);
    expect(screen.queryByText('Changes ready to review')).toBeNull();
    setQueuedMessages([]);
    expect(screen.getByText('Changes ready to review')).toBeTruthy();
  });

  it('keeps the controls hidden for a chat-only harness even with a pull request', () => {
    setSession(
      sessionWith({
        harness: 'in-memory',
        pullRequestUrl: 'https://github.com/macro-inc/macro/pull/42',
      })
    );
    render(() => (
      <AgentChangesProvider>
        <ChangesToggle />
      </AgentChangesProvider>
    ));
    expect(screen.queryByRole('button', { name: /Changes/ })).toBeNull();
  });
});
