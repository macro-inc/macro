import { CODEX_BOT_ID } from '@core/constant/codexAgent';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { describe, expect, it } from 'vitest';
import { agentSessionMark } from './agentSessionMark';

const TEAM_BOT = '11111111-2222-3333-4444-555555555555';

describe('agentSessionMark', () => {
  it.each(['claude-code', 'claude_code', 'Claude-Code'])(
    'paints %s with the Claude mark in Claude orange',
    (harness) => {
      expect(agentSessionMark({ harness, botId: TEAM_BOT }).class).toBe(
        'text-brand-claude'
      );
    }
  );

  it('gives Codex and Cursor sessions their ink marks', () => {
    const codex = agentSessionMark({ harness: 'codex' });
    const cursor = agentSessionMark({ harness: 'cursor' });
    expect(codex.class).toBe('text-ink');
    expect(cursor.class).toBe('text-ink');
    expect(codex.Icon).not.toBe(cursor.Icon);
  });

  it('lets first-party Cursor and Codex bots win over a stale harness', () => {
    expect(
      agentSessionMark({ harness: 'opencode', botId: CURSOR_BOT_ID }).Icon
    ).toBe(agentSessionMark({ harness: 'cursor' }).Icon);
    expect(
      agentSessionMark({ harness: 'opencode', botId: CODEX_BOT_ID }).Icon
    ).toBe(agentSessionMark({ harness: 'codex' }).Icon);
  });

  it('uses the Macro mark for Macro runtimes and first-party Macro bots', () => {
    expect(agentSessionMark({ harness: 'macro-inmem' }).class).toBe(
      'text-accent'
    );
    expect(agentSessionMark({ botId: MACRO_AGENT_BOT_ID }).class).toBe(
      'text-accent'
    );
  });

  it.each([undefined, 'hermes', 'opencode', 'unknown'])(
    'falls back to the neutral sparkle for %s',
    (harness) => {
      expect(agentSessionMark({ harness, botId: TEAM_BOT }).class).toBe(
        'text-chat'
      );
    }
  );
});
