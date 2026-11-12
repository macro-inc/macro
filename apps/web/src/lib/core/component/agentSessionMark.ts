import {
  type FirstPartyBotMark,
  firstPartyBotMark,
} from '@core/component/firstPartyBotMark';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import MacroLogo from '@icon/macro-logo.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CodexIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import type { Component, ComponentProps } from 'solid-js';

/** The mark a session reference wears, and the text color that tints it. */
export type AgentSessionMark = {
  Icon: Component<ComponentProps<'svg'>>;
  class: string;
};

const CLAUDE: AgentSessionMark = { Icon: ClaudeIcon, class: 'text-[#D97757]' };
const CODEX: AgentSessionMark = { Icon: CodexIcon, class: 'text-ink' };
const CURSOR: AgentSessionMark = { Icon: CursorIcon, class: 'text-ink' };
const MACRO: AgentSessionMark = { Icon: MacroLogo, class: 'text-accent' };
/** Harnesses Macro ships no logo for (OpenCode, OpenClaw, Hermes, ...). */
const GENERIC: AgentSessionMark = { Icon: SparkleIcon, class: 'text-chat' };

/**
 * Harness slugs as the service stamps them (`claude-code`, `codex-cloud`,
 * `macro-inmem`) and as the fold's enum spells them (`claude_code`).
 */
const BY_HARNESS: Record<string, AgentSessionMark> = {
  'claude-code': CLAUDE,
  claude: CLAUDE,
  codex: CODEX,
  'codex-cloud': CODEX,
  cursor: CURSOR,
  macro: MACRO,
  'macro-inmem': MACRO,
  'in-memory': MACRO,
  sandbox: MACRO,
};

function fromFirstParty(mark: FirstPartyBotMark): AgentSessionMark {
  return {
    Icon: mark.Icon,
    class: mark.tone === 'accent' ? 'text-accent' : 'text-ink',
  };
}

/**
 * The brand mark for the agent running a session: Claude in its orange for
 * Claude Code, Codex, Cursor, or Macro. A static lookup over fields the
 * mention preview already carries, so a chip costs no extra request.
 * First-party Cursor and Codex bots win over the harness, which older rows
 * stamped with the sandboxed-coder default.
 */
export function agentSessionMark(session?: {
  harness?: string | null;
  botId?: string | null;
}): AgentSessionMark {
  const botId = session?.botId ?? undefined;
  if (botId && isCursorBotId(botId)) return CURSOR;
  if (botId && isCodexBotId(botId)) return CODEX;
  const harness = session?.harness?.trim().toLowerCase().replaceAll('_', '-');
  const byHarness = harness ? BY_HARNESS[harness] : undefined;
  if (byHarness) return byHarness;
  const firstParty = firstPartyBotMark(botId);
  return firstParty ? fromFirstParty(firstParty) : GENERIC;
}
