import type { Connector, ConnectorStatus } from '@queries/connectors';
import { beforeEach, expect, it, vi } from 'vitest';
import { createOnboardingToolConnect } from './tool-connect';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/connectors', () => ({
  appConnectorKey: (slug: string) => `app/${slug}`,
  connectConnector: mocks.connect,
  readConnectors: mocks.read,
  useUpdateConnectorMutation: () => ({ mutateAsync: mocks.update }),
}));

function held(slug: string, status: ConnectorStatus): Connector {
  return {
    key: `app/${slug}`,
    target: { type: 'app', slug },
    name: slug,
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
  };
}
const tool = (slug: string) => ({ slug, name: slug, iconUrl: null });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue([]);
});

it('connects an app the user does not hold, GitHub included', async () => {
  for (const slug of ['notion', 'github']) {
    await createOnboardingToolConnect()(tool(slug));
    expect(mocks.connect).toHaveBeenLastCalledWith({ key: `app/${slug}` });
  }
});

it('connects again an app whose connection no longer counts', async () => {
  mocks.read.mockResolvedValue([
    held('linear', 'notConnected'),
    held('github', 'needsReauth'),
  ]);
  await createOnboardingToolConnect()(tool('linear'));
  await createOnboardingToolConnect()(tool('github'));
  expect(mocks.connect.mock.calls).toEqual([
    [{ key: 'app/linear' }],
    [{ key: 'app/github' }],
  ]);
});

it('switches a held app back on instead of connecting it again', async () => {
  mocks.read.mockResolvedValue([held('linear', 'disabled')]);
  await createOnboardingToolConnect()(tool('linear'));
  expect(mocks.update).toHaveBeenCalledWith({
    key: 'app/linear',
    enabled: true,
  });
  expect(mocks.connect).not.toHaveBeenCalled();
});

it('leaves connected apps and a linked GitHub account alone', async () => {
  mocks.read.mockResolvedValue([
    held('linear', 'connected'),
    held('github', 'disabled'),
  ]);
  await createOnboardingToolConnect()(tool('linear'));
  await createOnboardingToolConnect()(tool('github'));
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('connects nothing when connection status cannot be read', async () => {
  mocks.read.mockRejectedValue(new Error('Network failure'));
  await createOnboardingToolConnect()(tool('linear'));
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.failure).toHaveBeenCalled();
});
