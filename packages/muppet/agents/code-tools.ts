/**
 * The code-mode tools' names: the library's own, so they never collide with
 * Macro's MCP tools (ExecuteCode, DescribeCodeTools, ReadCodeDocs) when both
 * are offered. Kept apart from the Claude Code agent, so naming them doesn't
 * load the Agent SDK.
 */
export const codeTools = {
  run: 'RunCapabilityScript',
  describe: 'DescribeCapabilities',
} as const;
