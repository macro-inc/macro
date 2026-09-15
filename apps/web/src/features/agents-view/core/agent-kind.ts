import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import type { AgentsMode } from './mode';

/**
 * What an agent is for. A coder writes code: it takes a repository and runs on
 * a coding runtime (Cursor's cloud agents, or a macrod daemon on someone's
 * machine). Every other agent chats from Macro's own in-memory harness.
 *
 * The kind is not stored on the agent — the harness decides it, because only a
 * coding runtime can actually do coding work.
 */
export type AgentKind = 'agent' | 'coder';

/** Harness slugs that run inside Macro's process, with no coding runtime. */
const CHAT_HARNESSES: ReadonlySet<string> = new Set([
  'in-memory',
  'macro-inmem',
]);

export function isCoderHarness(harness: string | null | undefined): boolean {
  if (!harness) return false;
  return !CHAT_HARNESSES.has(harness);
}

export function kindForHarness(harness: string | null | undefined): AgentKind {
  return isCoderHarness(harness) ? 'coder' : 'agent';
}

/** The first-party bots, whose kind is fixed by what mentioning them does. */
const SYSTEM_BOT_KINDS: ReadonlyMap<string, AgentKind> = new Map([
  [MACRO_AGENT_BOT_ID, 'agent'],
  [MACRO_NEW_BOT_ID, 'agent'],
  [MACRO_CODER_BOT_ID, 'coder'],
  [CURSOR_BOT_ID, 'coder'],
]);

export function systemBotKind(
  botId: string | null | undefined
): AgentKind | undefined {
  if (!botId) return undefined;
  const bare = botId.startsWith('bot|') ? botId.slice('bot|'.length) : botId;
  return SYSTEM_BOT_KINDS.get(bare);
}

export function modeForKind(kind: AgentKind): AgentsMode {
  return kind === 'coder' ? 'code' : 'chat';
}

export function kindForMode(mode: AgentsMode): AgentKind {
  return mode === 'code' ? 'coder' : 'agent';
}

/** "agent" / "coder", capitalized for headings and buttons. */
export function agentKindNoun(kind: AgentKind, plural = false): string {
  const noun = kind === 'coder' ? 'coder' : 'agent';
  return plural ? `${noun}s` : noun;
}
