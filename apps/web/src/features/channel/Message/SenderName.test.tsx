/** @vitest-environment jsdom */

import type { MessageData } from '@core/messages/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageProvider } from './context';
import { MessageSenderName } from './SenderName';

const mocks = vi.hoisted(() => ({
  agentDashboards: true,
  openWithSplit: vi.fn(),
  rowClick: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: (flag: { key?: string }) =>
    flag.key === 'enable-agent-dashboards' && mocks.agentDashboards,
}));

vi.mock('@core/user', () => ({
  getDisplayName: (id: string | undefined) =>
    id === 'macro|agent@example.com' ? 'Ops Agent' : 'Jane Doe',
  isAgentAccount: (id: string | undefined) => id === 'macro|agent@example.com',
  tryMacroId: (id: string) => id,
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));

const message = (senderId: string) =>
  ({ id: 'message-1', content: 'hi', sender_id: senderId }) as MessageData;

const renderName = (senderId: string) =>
  render(() => (
    // The message row opens a thread on click; the name must not.
    <div onClick={mocks.rowClick}>
      <MessageProvider value={() => message(senderId)}>
        <MessageSenderName />
      </MessageProvider>
    </div>
  ));

beforeEach(() => {
  mocks.agentDashboards = true;
  mocks.openWithSplit.mockReset();
  mocks.rowClick.mockReset();
});

afterEach(cleanup);

describe('MessageSenderName', () => {
  it("opens an agent teammate's profile from its name", async () => {
    const user = userEvent.setup();
    renderName('macro|agent@example.com');

    await user.click(
      screen.getByRole('button', { name: 'Open Ops Agent’s profile' })
    );

    expect(mocks.openWithSplit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: 'agent-dashboard',
        params: { userId: 'macro|agent@example.com' },
      }),
      { activate: true, preferNewSplit: true }
    );
    expect(mocks.rowClick).not.toHaveBeenCalled();
  });

  it("leaves a person's name as plain text", async () => {
    const user = userEvent.setup();
    renderName('macro|jane@example.com');

    expect(screen.queryByRole('button')).toBeNull();
    await user.click(screen.getByText('Jane Doe'));
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('leaves an agent name as plain text with agent dashboards off', () => {
    mocks.agentDashboards = false;
    renderName('macro|agent@example.com');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Ops Agent')).toBeTruthy();
  });
});
