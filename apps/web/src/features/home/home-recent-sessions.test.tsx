import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { RecentSessionsSection } from './home-recent-sessions';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  openWithSplit: vi.fn(),
}));

vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  QUERY_FILTERS_BASE: {},
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: navigation.openWithSplit }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ handle: { replace: navigation.replace } }),
}));
vi.mock('@core/component/AI/util/storage', () => ({
  getChatStoredModel: () => undefined,
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <svg data-entity-type={props.targetType} />
  ),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupItemsQuery: () => ({
    data: [
      {
        type: 'chat',
        id: 'gpt-chat',
        name: 'GPT conversation',
        model: 'openai/gpt-5.5',
      },
      {
        type: 'chat',
        id: 'claude-chat',
        name: 'Claude conversation',
        model: 'anthropic/claude-sonnet-5',
      },
      { type: 'chat', id: 'unknown-chat', name: 'Unknown conversation' },
      {
        type: 'agent_session',
        id: 'agent-session-1',
        name: 'Code review session',
        botId: 'bot-1',
        status: 'completed',
      },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('uses saved providers for recent chats without requiring a local draft', () => {
  render(() => <RecentSessionsSection />);
  expect(
    screen
      .getByRole('button', { name: 'GPT conversation' })
      .querySelector('[data-ai-provider="openai"] svg')
  ).not.toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Claude conversation' })
      .querySelector('[data-ai-provider="anthropic"] svg')
  ).not.toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Unknown conversation' })
      .querySelector('[data-entity-type="chat"]')
  ).not.toBeNull();
});

it('keeps normal clicks in the source split and opens Shift-clicks in a new split', () => {
  render(() => <RecentSessionsSection />);
  const button = screen.getByRole('button', { name: 'GPT conversation' });
  fireEvent.click(button);
  expect(navigation.replace).toHaveBeenCalledWith({
    next: { type: 'chat', id: 'gpt-chat' },
  });
  expect(navigation.openWithSplit).not.toHaveBeenCalled();
  navigation.replace.mockClear();

  fireEvent.click(button, { shiftKey: true });
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(navigation.openWithSplit).toHaveBeenCalledWith(
    { type: 'chat', id: 'gpt-chat' },
    { activate: true, preferNewSplit: true }
  );
});

it('renders agent sessions with agent icon and opens them with type agent', () => {
  render(() => <RecentSessionsSection limit={5} />);
  const button = screen.getByRole('button', { name: 'Code review session' });
  expect(button.querySelector('[data-entity-type="agent"]')).not.toBeNull();

  fireEvent.click(button);
  expect(navigation.replace).toHaveBeenCalledWith({
    next: { type: 'agent', id: 'agent-session-1' },
  });
});
