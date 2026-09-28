import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentsEnabled: false,
  openChatWithMessage: vi.fn(),
  startPendingSession: vi.fn(() => 'pending-session'),
  openWithSplit: vi.fn(),
  manager: true,
  failure: vi.fn(),
}));

vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: mocks.startPendingSession,
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  openChatWithMessage: mocks.openChatWithMessage,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () =>
    mocks.manager ? { openWithSplit: mocks.openWithSplit } : undefined,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: { key: 'enable-chat-v3-agents' },
  isFeatureEnabled: () => mocks.agentsEnabled,
}));

import { openMobileAskAi } from './open-mobile-ask-ai';

describe('openMobileAskAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentsEnabled = false;
    mocks.manager = true;
    mocks.startPendingSession.mockReturnValue('pending-session');
  });

  it('opens the cognition chat when chat v3 agents are off', () => {
    openMobileAskAi('reply to Margot');

    expect(mocks.openChatWithMessage).toHaveBeenCalledWith('reply to Margot');
    expect(mocks.startPendingSession).not.toHaveBeenCalled();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('starts an agent session with the query when chat v3 agents are on', () => {
    mocks.agentsEnabled = true;

    openMobileAskAi('reply to Margot');

    expect(mocks.startPendingSession).toHaveBeenCalledWith({
      prompt: 'reply to Margot',
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'agent', id: 'pending-session' },
      { activate: true, preferNewSplit: true }
    );
    expect(mocks.openChatWithMessage).not.toHaveBeenCalled();
  });

  it('reports a failure and skips session creation when no split can open', () => {
    mocks.agentsEnabled = true;
    mocks.manager = false;

    openMobileAskAi('reply to Margot');

    expect(mocks.failure).toHaveBeenCalledWith('Unable to open chat');
    expect(mocks.startPendingSession).not.toHaveBeenCalled();
    expect(mocks.openChatWithMessage).not.toHaveBeenCalled();
  });
});
