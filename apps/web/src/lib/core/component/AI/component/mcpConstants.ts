export const MACRO_MCP_URL = 'https://mcp-server.macro.com/mcp';

export const MACRO_MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      macro: {
        type: 'http',
        url: MACRO_MCP_URL,
      },
    },
  },
  null,
  2
);

export const CLI_COMMANDS = [
  {
    key: 'claude-cli',
    label: 'Claude Code',
    command: `claude mcp add --transport http macro ${MACRO_MCP_URL}`,
  },
  {
    key: 'codex-cli',
    label: 'Codex CLI',
    command: `codex mcp add macro --url ${MACRO_MCP_URL}`,
  },
] as const;

export const WEB_CLIENTS = [
  {
    key: 'claude-web',
    label: 'Claude.ai',
    hint: 'Settings → Connectors → Add custom connector',
  },
  {
    key: 'chatgpt-web',
    label: 'ChatGPT',
    hint: 'Settings → Apps → Advanced settings → enable Developer mode, then Create App',
  },
] as const;
