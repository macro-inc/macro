import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('remembers new sessions across reloads without mixing accounts or duplicating renames', async () => {
  const { rememberAgentSession } = await import('./recent-sessions');
  rememberAgentSession('viewer', {
    id: 'one',
    name: 'First',
    modifiedAt: '2026-09-08T01:00:00Z',
  });
  rememberAgentSession('other', {
    id: 'private',
    name: 'Other user',
    modifiedAt: '2026-09-08T03:00:00Z',
  });
  rememberAgentSession('viewer', {
    id: 'two',
    name: 'Second',
    modifiedAt: '2026-09-08T02:00:00Z',
  });
  rememberAgentSession('viewer', {
    id: 'one',
    name: 'Renamed',
    modifiedAt: '2026-09-08T04:00:00Z',
  });
  vi.resetModules();
  const { useRecentAgentSessions } = await import('./recent-sessions');
  let sessions!: ReturnType<typeof useRecentAgentSessions>;
  render(() => {
    sessions = useRecentAgentSessions();
    return null;
  });
  await waitFor(() =>
    expect(sessions().map((s) => s.name)).toEqual(['Renamed', 'Second'])
  );
});

it('ignores malformed saved history', async () => {
  localStorage.setItem('recent-agent-sessions:viewer', '{broken');
  const { useRecentAgentSessions } = await import('./recent-sessions');
  let sessions!: ReturnType<typeof useRecentAgentSessions>;
  render(() => {
    sessions = useRecentAgentSessions();
    return null;
  });
  await waitFor(() => expect(sessions()).toEqual([]));
});
