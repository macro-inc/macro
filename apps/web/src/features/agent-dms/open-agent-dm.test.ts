import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mobile: false,
  createDm: vi.fn(),
  replaceSplit: vi.fn(),
  closeSettings: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({
    mutateAsync: mocks.createDm,
    isPending: false,
  }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ replaceSplit: mocks.replaceSplit }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ closeSettings: mocks.closeSettings }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

import { useOpenAgentDm } from './open-agent-dm';

let dispose: (() => void) | undefined;

function openAgentDm() {
  return createRoot((root) => {
    dispose = root;
    return useOpenAgentDm();
  });
}

beforeEach(() => {
  mocks.mobile = false;
  mocks.createDm.mockResolvedValue({ channel_id: 'dm' });
});

afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});

it('closes the settings sheet over a DM it opened on a phone', async () => {
  mocks.mobile = true;
  await openAgentDm().open('persona');
  expect(mocks.createDm).toHaveBeenCalledWith({ recipient_id: 'bot|persona' });
  expect(mocks.replaceSplit).toHaveBeenCalledWith({
    content: { type: 'channel', id: 'dm' },
  });
  expect(mocks.closeSettings).toHaveBeenCalledOnce();
});

it('leaves settings to the split the DM replaced elsewhere', async () => {
  await openAgentDm().open('persona');
  expect(mocks.replaceSplit).toHaveBeenCalledOnce();
  expect(mocks.closeSettings).not.toHaveBeenCalled();
});

it('keeps settings open when the DM could not be opened', async () => {
  mocks.mobile = true;
  mocks.createDm.mockRejectedValue(new Error('offline'));
  await openAgentDm().open('persona');
  expect(mocks.replaceSplit).not.toHaveBeenCalled();
  expect(mocks.closeSettings).not.toHaveBeenCalled();
  expect(mocks.failure).toHaveBeenCalledOnce();
});
