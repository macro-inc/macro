import RobotIcon from '@icon/system/regular/robot.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import OpenAiIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import OpenCodeIcon from '@icon/wide-opencode.svg';
import type { McpClientKind } from '@service-storage/generated/schemas/mcpClientKind';
import type { FirstPartyBotMark } from './firstPartyBotMark';

const MARKS: Record<McpClientKind, FirstPartyBotMark> = {
  claude: { Icon: ClaudeIcon, tone: 'ink' },
  claude_code: { Icon: ClaudeIcon, tone: 'ink' },
  chatgpt: { Icon: OpenAiIcon, tone: 'ink' },
  codex: { Icon: OpenAiIcon, tone: 'ink' },
  cursor: { Icon: CursorIcon, tone: 'ink' },
  opencode: { Icon: OpenCodeIcon, tone: 'ink' },
};

/**
 * The brand mark for a post an MCP client wrote, by the product the server
 * verified it as. Undefined for an unrecognized client, which keeps its
 * initial, including a kind this build does not know yet.
 */
export function mcpClientMark(
  kind: McpClientKind | null | undefined
): FirstPartyBotMark | undefined {
  if (!kind) return undefined;
  return MARKS[kind];
}

/**
 * The avatar for a client the server did not verify: a generic robot, never
 * an initial, which could pass for a product's mark.
 */
export const UNVERIFIED_CLIENT_MARK: FirstPartyBotMark = {
  Icon: RobotIcon,
  tone: 'ink',
};
