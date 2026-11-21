import {
  AppConnectionContext,
  ConnectCardAccessContext,
} from '@core/pipedream/connection-context';
import { render } from '@solidjs/testing-library';
import { useContext } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userId: 'macro|reader@example.com' as string | undefined,
  ownerId: undefined as string | undefined,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => mocks.userId }));
vi.mock('@queries/agent-session/session', () => ({
  useAgentSessionQuery: () => ({
    get data() {
      return mocks.ownerId ? { ownerId: mocks.ownerId } : undefined;
    },
  }),
}));

import { OwnerConnectAccess } from './owner-connect-access';

function readAccess() {
  let allowed: boolean | undefined;
  function Probe() {
    allowed = useContext(ConnectCardAccessContext)?.allowed();
    return null;
  }
  render(() => (
    <OwnerConnectAccess sessionId="session-1">
      <Probe />
    </OwnerConnectAccess>
  ));
  return allowed;
}

describe("connect cards outside the owner's session", () => {
  beforeEach(() => {
    mocks.userId = 'macro|reader@example.com';
    mocks.ownerId = undefined;
  });

  it("lets the session's owner connect", () => {
    mocks.ownerId = 'macro|reader@example.com';
    expect(readAccess()).toBe(true);
  });

  it('keeps everyone else from connecting', () => {
    mocks.ownerId = 'macro|owner@example.com';
    expect(readAccess()).toBe(false);
  });

  it('keeps Connect disabled while the owner is unknown', () => {
    expect(readAccess()).toBe(false);
    mocks.userId = undefined;
    mocks.ownerId = 'macro|owner@example.com';
    expect(readAccess()).toBe(false);
  });

  it("judges another session's cards by that session, not the one around it", () => {
    mocks.ownerId = 'macro|owner@example.com';
    let outer: unknown = 'unset';
    let allowed: boolean | undefined;
    function Probe() {
      outer = useContext(AppConnectionContext);
      allowed = useContext(ConnectCardAccessContext)?.allowed();
      return null;
    }
    render(() => (
      <AppConnectionContext.Provider
        value={{ connect: async () => {}, disabled: () => false }}
      >
        <OwnerConnectAccess sessionId="session-1">
          <Probe />
        </OwnerConnectAccess>
      </AppConnectionContext.Provider>
    ));

    expect(outer).toBeUndefined();
    expect(allowed).toBe(false);
  });
});
