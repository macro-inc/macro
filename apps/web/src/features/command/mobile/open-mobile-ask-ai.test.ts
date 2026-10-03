import { expect, it, vi } from 'vitest';

vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  openChatWithMessage: vi.fn(),
}));

import { openChatWithMessage } from '@app/features/chat/ChatWithAgentButton';
import { openMobileAskAi } from './open-mobile-ask-ai';

it('uses the same agent handoff as desktop search and the command menu', () => {
  expect(openMobileAskAi).toBe(openChatWithMessage);
});
