/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readProductTokens: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));

vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'mcp-service': 'https://mcp-server.example' },
}));

vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    readProductTokens: mocks.readProductTokens,
  },
}));

import {
  MCP_SESSION_STORAGE_KEY,
  completeMcpLoginIfPresent,
  isSafeMcpClientRedirect,
  persistMcpSessionFromSearch,
} from './mcpLogin';

describe('mcpLogin', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.readProductTokens.mockReset();
    mocks.toastFailure.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists a session id from the query string', () => {
    const sessionId = '0199c2c0-6f3a-7c1e-8d2b-0a1b2c3d4e5f';
    expect(persistMcpSessionFromSearch(`?mcp_session=${sessionId}`)).toBe(
      sessionId
    );
    expect(sessionStorage.getItem(MCP_SESSION_STORAGE_KEY)).toBe(sessionId);
  });

  it('ignores a non-uuid session id', () => {
    expect(persistMcpSessionFromSearch('?mcp_session=not-a-uuid')).toBeUndefined();
    expect(sessionStorage.getItem(MCP_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('accepts https and loopback redirects only', () => {
    expect(isSafeMcpClientRedirect('http://127.0.0.1:54321/callback?code=1')).toBe(
      true
    );
    expect(isSafeMcpClientRedirect('https://claude.ai/callback?code=1')).toBe(
      true
    );
    expect(isSafeMcpClientRedirect('http://evil.example/callback')).toBe(false);
    expect(isSafeMcpClientRedirect('javascript:alert(1)')).toBe(false);
  });

  it('posts product tokens and follows the broker redirect', async () => {
    const sessionId = '0199c2c0-6f3a-7c1e-8d2b-0a1b2c3d4e5f';
    sessionStorage.setItem(MCP_SESSION_STORAGE_KEY, sessionId);
    mocks.readProductTokens.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    const assign = vi.fn();
    const hrefDescriptor = Object.getOwnPropertyDescriptor(
      window.location,
      'href'
    );
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      set: assign,
      get: () => 'https://macro.example/login?mcp_session=' + sessionId,
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ redirect: 'http://127.0.0.1:54321/callback?code=abc' }),
        { status: 200 }
      )
    );

    await expect(completeMcpLoginIfPresent()).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      `https://mcp-server.example/login/${sessionId}/complete`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer access',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: 'refresh' }),
      })
    );
    expect(assign).toHaveBeenCalledWith(
      'http://127.0.0.1:54321/callback?code=abc'
    );
    expect(sessionStorage.getItem(MCP_SESSION_STORAGE_KEY)).toBeNull();

    if (hrefDescriptor) {
      Object.defineProperty(window.location, 'href', hrefDescriptor);
    }
  });
});
