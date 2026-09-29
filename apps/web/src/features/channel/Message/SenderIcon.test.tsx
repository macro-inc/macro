import { CURSOR_BOT_PRINCIPAL_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import type { MessageData } from '@core/messages/types';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageProvider } from './context';
import { SenderIcon } from './SenderIcon';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => (
    <span data-testid="user-icon">{props.id}</span>
  ),
}));
vi.mock('./BotIcon', () => ({
  BotIcon: (props: { name?: string | null; avatarUrl?: string | null }) => (
    <span data-testid="bot-icon" data-avatar={props.avatarUrl ?? ''}>
      {props.name}
    </span>
  ),
}));

afterEach(cleanup);

const TEAM_BOT_ID = '11111111-2222-3333-4444-555555555555';

const message = (senderId: string, sender?: MessageData['sender']) =>
  ({
    id: 'message-1',
    content: 'hi',
    sender_id: senderId,
    sender,
  }) as unknown as MessageData;

const renderSender = (data: MessageData) =>
  render(() => (
    <MessageProvider value={() => data}>
      <SenderIcon />
    </MessageProvider>
  ));

describe('SenderIcon', () => {
  it('draws first-party bots through UserIcon so they keep their brand mark', () => {
    for (const id of [
      MACRO_AGENT_PRINCIPAL_ID,
      MACRO_NEW_PRINCIPAL_ID,
      CURSOR_BOT_PRINCIPAL_ID,
    ]) {
      const { getByTestId, queryByTestId } = renderSender(message(id));
      expect(getByTestId('user-icon').textContent).toBe(id);
      expect(queryByTestId('bot-icon')).toBeNull();
      cleanup();
    }
  });

  it('draws a team bot with its own uploaded avatar', () => {
    const { getByTestId, queryByTestId } = renderSender(
      message(`bot|${TEAM_BOT_ID}`, {
        type: 'bot',
        id: TEAM_BOT_ID,
        name: 'Helper',
        avatar_url: 'https://cdn/helper.png',
      })
    );
    const icon = getByTestId('bot-icon');
    expect(icon.textContent).toBe('Helper');
    expect(icon.dataset.avatar).toBe('https://cdn/helper.png');
    expect(queryByTestId('user-icon')).toBeNull();
  });

  it('draws people through UserIcon', () => {
    const { getByTestId } = renderSender(message('macro|peter@macro.com'));
    expect(getByTestId('user-icon').textContent).toBe('macro|peter@macro.com');
  });
});
