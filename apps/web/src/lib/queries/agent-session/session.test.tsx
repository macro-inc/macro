/**
 * @vitest-environment jsdom
 */

import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cursorSessionIdAwaitingExternalUrl,
  EXTERNAL_URL_POLL_ATTEMPTS,
  EXTERNAL_URL_POLL_INTERVAL_MS,
  nextExternalUrlPollInterval,
  useAgentSessionExternalUrlQuery,
} from './session';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

const snapshot = (
  over: Partial<AgentSessionResponse> = {}
): AgentSessionResponse =>
  ({
    id: 'session',
    name: 'Agent Session',
    botId: 'bot',
    harness: 'claude-code',
    model: 'claude',
    createdAt: '2026-08-24T12:00:00Z',
    modifiedAt: '2026-08-24T12:00:00Z',
    ownerId: 'macro|wolf@macro.com',
    sandboxSize: 'small',
    status: { kind: 'no_messages' },
    workspace: '/',
    ...over,
  }) as AgentSessionResponse;

function pollState(
  over: Partial<Parameters<typeof nextExternalUrlPollInterval>[0]['state']>
) {
  return {
    state: {
      data: undefined,
      dataUpdateCount: 0,
      errorUpdateCount: 0,
      ...over,
    },
  };
}

describe('nextExternalUrlPollInterval', () => {
  it('keeps polling while the url is missing and budget remains', () => {
    expect(nextExternalUrlPollInterval(pollState({ dataUpdateCount: 1 }))).toBe(
      EXTERNAL_URL_POLL_INTERVAL_MS
    );
    expect(
      nextExternalUrlPollInterval(
        pollState({ dataUpdateCount: EXTERNAL_URL_POLL_ATTEMPTS - 1 })
      )
    ).toBe(EXTERNAL_URL_POLL_INTERVAL_MS);
  });

  it('stops once the snapshot carries a url', () => {
    expect(
      nextExternalUrlPollInterval(
        pollState({
          dataUpdateCount: 1,
          data: snapshot({
            external: {
              provider: 'cursor',
              url: 'https://cursor.com/agents/bc-1',
            },
          }),
        })
      )
    ).toBe(false);
  });

  it('stops when successful and failed fetches together spend the budget', () => {
    expect(
      nextExternalUrlPollInterval(
        pollState({
          dataUpdateCount: 10,
          errorUpdateCount: 5,
        })
      )
    ).toBe(false);
    expect(
      nextExternalUrlPollInterval(
        pollState({
          dataUpdateCount: 0,
          errorUpdateCount: EXTERNAL_URL_POLL_ATTEMPTS,
        })
      )
    ).toBe(false);
  });
});

describe('cursorSessionIdAwaitingExternalUrl', () => {
  it('enables only for a loaded Cursor session whose url is still missing', () => {
    expect(cursorSessionIdAwaitingExternalUrl(undefined, snapshot())).toBe(
      undefined
    );
    expect(cursorSessionIdAwaitingExternalUrl('session', undefined)).toBe(
      undefined
    );
    expect(
      cursorSessionIdAwaitingExternalUrl(
        'session',
        snapshot({ botId: 'other' })
      )
    ).toBe(undefined);
    expect(
      cursorSessionIdAwaitingExternalUrl(
        'session',
        snapshot({
          botId: CURSOR_BOT_ID,
          external: { provider: 'cursor', url: 'https://cursor.com/agents/x' },
        })
      )
    ).toBe(undefined);
    expect(
      cursorSessionIdAwaitingExternalUrl(
        'session',
        snapshot({ botId: CURSOR_BOT_ID })
      )
    ).toBe('session');
    expect(
      cursorSessionIdAwaitingExternalUrl(
        'session',
        snapshot({
          botId: CURSOR_BOT_ID,
          external: { provider: 'cursor' },
        })
      )
    ).toBe('session');
  });
});

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  function Host() {
    hook = factory();
    return null as unknown as JSX.Element;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        <Host />
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

describe('useAgentSessionExternalUrlQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('does not fetch while the session id is absent', async () => {
    const query = renderHook(() =>
      useAgentSessionExternalUrlQuery(() => undefined)
    );
    await Promise.resolve();
    expect(getMock).not.toHaveBeenCalled();
    expect(query.isFetching).toBe(false);
  });

  it('fetches the snapshot once a session id is given', async () => {
    getMock.mockResolvedValue(
      ok(
        snapshot({
          external: {
            provider: 'cursor',
            url: 'https://cursor.com/agents/bc-1',
          },
        })
      )
    );
    const query = renderHook(() =>
      useAgentSessionExternalUrlQuery(() => 'session')
    );
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('session');
    expect(query.data?.external?.url).toBe('https://cursor.com/agents/bc-1');
  });

  it('starts fetching when the session id appears after mount', async () => {
    getMock.mockResolvedValue(ok(snapshot()));
    const [id, setId] = createSignal<string | undefined>();
    const query = renderHook(() => useAgentSessionExternalUrlQuery(id));
    await Promise.resolve();
    expect(getMock).not.toHaveBeenCalled();

    setId('session');
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('session');
  });
});
