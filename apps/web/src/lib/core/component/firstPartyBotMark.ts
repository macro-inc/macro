import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { isMacroCoderId } from '@core/constant/macroCoder';
import { isMacroNewId } from '@core/constant/macroNew';
import { isMacroSystemId } from '@core/constant/macroSystem';
import MacroLogo from '@icon/macro-logo.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CodexIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import type { Component, ComponentProps } from 'solid-js';

/** The brand mark a first-party bot wears wherever an avatar is drawn. */
export type FirstPartyBotMark = {
  Icon: Component<ComponentProps<'svg'>>;
  /** Macro's own marks take the accent color; partner marks stay ink. */
  tone: 'accent' | 'ink';
};

const MACRO_MARK: FirstPartyBotMark = { Icon: MacroLogo, tone: 'accent' };
const CURSOR_MARK: FirstPartyBotMark = { Icon: CursorIcon, tone: 'ink' };
const CODEX_MARK: FirstPartyBotMark = { Icon: CodexIcon, tone: 'ink' };
const CLAUDE_MARK: FirstPartyBotMark = { Icon: ClaudeIcon, tone: 'ink' };

/** Keyed by the first word of a client's registered name, lowercased. */
const MCP_CLIENT_MARKS = new Map<string, FirstPartyBotMark>([
  ['claude', CLAUDE_MARK],
  ['cursor', CURSOR_MARK],
  ['codex', CODEX_MARK],
]);

/**
 * The avatar mark for a first-party bot (bare UUID or `bot|<uuid>`). System
 * bots have no `bots` row and therefore no `avatar_url`; their picture is the
 * mark the client ships, so every surface (mention menu, message sender,
 * inbox) resolves it here rather than falling back to an initial or a generic
 * robot. Undefined for team bots, which carry their own avatar.
 */
export function firstPartyBotMark(
  id: string | undefined
): FirstPartyBotMark | undefined {
  if (!id) return undefined;
  if (
    isMacroAgentId(id) ||
    isMacroNewId(id) ||
    isMacroCoderId(id) ||
    isMacroSystemId(id)
  ) {
    return MACRO_MARK;
  }
  if (isCursorBotId(id)) return CURSOR_MARK;
  if (isCodexBotId(id)) return CODEX_MARK;
  return undefined;
}

/**
 * The brand mark for an MCP client by the name it registered with ("Claude",
 * "Claude Code", "Cursor"), which is what a post made through it is labeled.
 * Undefined for clients without a shipped mark.
 */
export function mcpClientMark(
  clientName: string
): FirstPartyBotMark | undefined {
  const firstWord = clientName.trim().split(/\s+/)[0]?.toLowerCase();
  return firstWord ? MCP_CLIENT_MARKS.get(firstWord) : undefined;
}

/** Text color class for a mark's tone. */
export function firstPartyBotMarkTone(mark: FirstPartyBotMark): string {
  return mark.tone === 'accent' ? 'text-accent' : 'text-ink';
}
