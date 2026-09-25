import { isClaudeBotId } from '@core/constant/claudeAgent';
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
const CLAUDE_MARK: FirstPartyBotMark = { Icon: ClaudeIcon, tone: 'ink' };
const CODEX_MARK: FirstPartyBotMark = { Icon: CodexIcon, tone: 'ink' };

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
  if (isClaudeBotId(id)) return CLAUDE_MARK;
  if (isCodexBotId(id)) return CODEX_MARK;
  return undefined;
}

/** Text color class for a mark's tone. */
export function firstPartyBotMarkTone(mark: FirstPartyBotMark): string {
  return mark.tone === 'accent' ? 'text-accent' : 'text-ink';
}
