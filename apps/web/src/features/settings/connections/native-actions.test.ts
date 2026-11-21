import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizationUrl: '',
  failure: vi.fn(),
  writeAttempted: vi.fn(),
}));
vi.mock('@core/util/platform', () => ({ isTauri: () => false }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('../mcp-auth-attempt', () => ({
  writeMcpAuthAttempted: mocks.writeAttempted,
}));
vi.mock('@queries/mcp-servers', () => ({
  useStartMcpAuthMutation: () => ({
    mutate: (
      _variables: unknown,
      options: { onSuccess: (result: { authorization_url: string }) => void }
    ) => options.onSuccess({ authorization_url: mocks.authorizationUrl }),
  }),
  useUpdateMcpServerMutation: () => ({}),
  useDeleteMcpServerMutation: () => ({}),
}));

import { useNativeMcpActions } from './native-actions';

describe('Settings → Connections sign-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a sign-in page that is not https and reports the failure', () => {
    const tab = { closed: false, close: vi.fn(), location: { href: 'about:blank' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    mocks.authorizationUrl = 'javascript:alert(document.cookie)//';
    const onStarted = vi.fn();
    const onFailed = vi.fn();

    useNativeMcpActions().startAuth('https://mcp.evil.example/mcp', 'Evil', {
      onStarted,
      onFailed,
    });

    expect(tab.location.href).toBe('about:blank');
    expect(tab.close).toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith('Failed to start authorization');
  });

  it('opens an https sign-in page', () => {
    const tab = { closed: false, close: vi.fn(), location: { href: 'about:blank' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    mocks.authorizationUrl = 'https://auth.example.com/authorize?state=s';
    const onStarted = vi.fn();

    useNativeMcpActions().startAuth('https://mcp.example.com/mcp', 'Example', {
      onStarted,
    });

    expect(tab.location.href).toBe('https://auth.example.com/authorize?state=s');
    expect(onStarted).toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });
});
