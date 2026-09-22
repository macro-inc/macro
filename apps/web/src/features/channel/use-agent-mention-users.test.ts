import { CLAUDE_BOT_PRINCIPAL_ID } from '@core/constant/claudeAgent';
import { CURSOR_BOT_PRINCIPAL_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_SYSTEM_PRINCIPAL_ID } from '@core/constant/macroSystem';
import type { IUser } from '@core/user/types';
import { describe, expect, it } from 'vitest';
import { agentsAssignableToTasks } from './use-agent-mention-users';

function mentionUser(id: string, name: string): IUser {
  return { id, name, email: name };
}

describe('agentsAssignableToTasks', () => {
  it('drops the agents whose mention opens no session', () => {
    expect(
      agentsAssignableToTasks([
        mentionUser(MACRO_AGENT_PRINCIPAL_ID, 'Macro'),
        mentionUser(MACRO_SYSTEM_PRINCIPAL_ID, 'Macro System'),
        mentionUser(CURSOR_BOT_PRINCIPAL_ID, 'Cursor'),
        mentionUser(CLAUDE_BOT_PRINCIPAL_ID, 'Claude'),
        mentionUser('bot|custom', 'Custom agent'),
      ]).map((user) => user.id)
    ).toEqual([CURSOR_BOT_PRINCIPAL_ID, CLAUDE_BOT_PRINCIPAL_ID, 'bot|custom']);
  });
});
