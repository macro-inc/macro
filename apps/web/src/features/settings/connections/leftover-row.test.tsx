/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readMcpAuthAttempted,
  writeMcpAuthAttempted,
} from '../mcp-auth-attempt';
import { LeftoverRow } from './leftover-row';
import type { Leftover } from './model';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@queries/mcp-servers', () => ({
  useStartMcpAuthMutation: () => ({
    mutate: mocks.authorize,
    isPending: false,
  }),
  useUpdateMcpServerMutation: () => ({
    mutate: mocks.update,
    isPending: false,
  }),
  useDeleteMcpServerMutation: () => ({
    mutate: mocks.remove,
    isPending: false,
  }),
}));

vi.mock('@queries/pipedream-connectors', () => ({
  useUpdatePipedreamConnectionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeletePipedreamConnectionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogConnect: () => ({
    connect: vi.fn(),
    busy: () => false,
  }),
}));

vi.mock('@ui', async (importOriginal) => {
  const { mockUiWithDropdown } = await import('./mock-dropdown');
  return mockUiWithDropdown(() => importOriginal<typeof import('@ui')>());
});

const leftover: Leftover = {
  kind: 'native-mcp',
  id: 'mcp:https://example.com/mcp',
  title: 'Linear',
  subtitle: 'example.com/mcp',
  url: 'https://example.com/mcp',
  enabled: true,
  authenticated: false,
};

afterEach(() => {
  localStorage.clear();
  mocks.authorize.mockReset();
});

describe('LeftoverRow native MCP auth', () => {
  it('opens a blank popup before the auth mutation resolves', () => {
    const popup = { opener: window, location: { href: '' }, close: vi.fn() };
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);
    mocks.authorize.mockImplementation((_vars, opts) => {
      opts?.onSuccess?.({ authorization_url: 'https://oauth.example/start' });
    });

    render(() => <LeftoverRow leftover={leftover} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.location.href).toBe('https://oauth.example/start');
    expect(screen.queryByText('Last attempt failed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('shows Last attempt failed only after a start error', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    mocks.authorize.mockImplementation((_vars, opts) => {
      opts?.onError?.();
    });

    render(() => <LeftoverRow leftover={leftover} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(screen.getByText('Last attempt failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('shows Last attempt failed for a persisted prior attempt', () => {
    writeMcpAuthAttempted(leftover.url, true);
    render(() => <LeftoverRow leftover={leftover} />);
    expect(screen.getByText('Last attempt failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('clears a persisted attempt after the server authenticates', () => {
    writeMcpAuthAttempted(leftover.url, true);
    render(() => (
      <LeftoverRow leftover={{ ...leftover, authenticated: true }} />
    ));
    expect(readMcpAuthAttempted(leftover.url)).toBe(false);
    expect(screen.queryByText('Last attempt failed')).toBeNull();
  });
});
