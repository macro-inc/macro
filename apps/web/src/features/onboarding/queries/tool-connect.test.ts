import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnboardingToolConnect } from './tool-connect';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  init: vi.fn(),
  reauthenticate: vi.fn(),
  fetch: vi.fn(),
  pipedream: vi.fn(),
  failure: vi.fn(),
  updateNative: vi.fn(),
  updatePipedream: vi.fn(),
}));
vi.mock('@core/auth/authorize-github', () => ({
  authorizeGithub: mocks.authorize,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/auth', () => ({
  useInitGithubLinkMutation: () => ({ mutateAsync: mocks.init }),
  useReauthenticateGithubMutation: () => ({
    mutateAsync: mocks.reauthenticate,
  }),
}));
vi.mock('@queries/auth/github-link', () => ({
  githubLinkStatusQueryOptions: () => ({ queryKey: ['github'] }),
}));
vi.mock('@queries/client', () => ({
  queryClient: { fetchQuery: mocks.fetch },
}));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogConnect: () => ({ connect: mocks.pipedream }),
}));
vi.mock('@queries/mcp-servers', () => ({
  mcpServersQueryOptions: () => ({ queryKey: ['native'] }),
  useUpdateMcpServerMutation: () => ({ mutateAsync: mocks.updateNative }),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  pipedreamConnectionsQueryOptions: () => ({ queryKey: ['pipedream'] }),
  useUpdatePipedreamConnectionMutation: () => ({
    mutateAsync: mocks.updatePipedream,
  }),
}));
const github = { slug: 'github', name: 'GitHub', iconUrl: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockResolvedValue([]);
  mocks.authorize.mockImplementation(async (getUrl) => {
    await getUrl('https://macro.com/app/onboarding');
    return true;
  });
});

describe('native GitHub onboarding', () => {
  it.each(['unlinked', 'reauthentication_required'])(
    'uses native OAuth for %s accounts',
    async (status) => {
      mocks.fetch.mockResolvedValue({ status });
      await createOnboardingToolConnect()(github);
      expect(
        status === 'unlinked' ? mocks.init : mocks.reauthenticate
      ).toHaveBeenCalledWith('https://macro.com/app/onboarding');
      expect(mocks.pipedream).not.toHaveBeenCalled();
    }
  );
  it('does not reconnect an already linked native account', async () => {
    mocks.fetch.mockResolvedValue({ status: 'linked' });
    await createOnboardingToolConnect()(github);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.pipedream).not.toHaveBeenCalled();
  });
  it('never falls back to Pipedream when native authorization fails', async () => {
    mocks.fetch.mockResolvedValue({ status: 'unlinked' });
    mocks.init.mockRejectedValue(new Error('Unavailable'));
    await createOnboardingToolConnect()(github);
    expect(mocks.failure).toHaveBeenCalled();
    expect(mocks.pipedream).not.toHaveBeenCalled();
  });
  it('keeps other tools on the existing Pipedream flow', async () => {
    await createOnboardingToolConnect()({
      ...github,
      slug: 'notion',
      name: 'Notion',
    });
    expect(mocks.pipedream).toHaveBeenCalledOnce();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});

it('enables an existing native connection without starting another OAuth flow', async () => {
  mocks.fetch.mockImplementation(async ({ queryKey }) =>
    queryKey[0] === 'native'
      ? [
          {
            url: 'https://mcp.linear.app/mcp',
            authenticated: true,
            enabled: false,
          },
        ]
      : []
  );
  await createOnboardingToolConnect()({
    slug: 'linear',
    name: 'Linear',
    iconUrl: null,
  });
  expect(mocks.updateNative).toHaveBeenCalledWith({
    url: 'https://mcp.linear.app/mcp',
    enabled: true,
  });
  expect(mocks.pipedream).not.toHaveBeenCalled();
});
it('recognizes existing Slack aliases and avoids reconnecting', async () => {
  mocks.fetch.mockImplementation(async ({ queryKey }) =>
    queryKey[0] === 'pipedream' ? [{ app_slug: 'slack_v2', enabled: true }] : []
  );
  await createOnboardingToolConnect()({
    slug: 'slack',
    name: 'Slack',
    iconUrl: null,
  });
  expect(mocks.pipedream).not.toHaveBeenCalled();
  expect(mocks.updatePipedream).not.toHaveBeenCalled();
});
it('does not initiate OAuth when connection status cannot be established', async () => {
  mocks.fetch.mockRejectedValue(new Error('Network failure'));
  await createOnboardingToolConnect()({
    slug: 'linear',
    name: 'Linear',
    iconUrl: null,
  });
  expect(mocks.pipedream).not.toHaveBeenCalled();
  expect(mocks.failure).toHaveBeenCalled();
});
