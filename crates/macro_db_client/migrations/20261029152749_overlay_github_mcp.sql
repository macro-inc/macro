-- GitHub connects through its own MCP server, authorized by the user's Macro
-- GitHub account link (the same GitHub App) rather than a Pipedream grant, so
-- a user connects GitHub once. No non-MCP reader uses a Pipedream GitHub
-- grant; existing ones stop being read and the app asks the user to link.
INSERT INTO mcp_overlays (app_slug, server_url)
VALUES ('github', 'https://api.githubcopilot.com/mcp')
ON CONFLICT (app_slug) DO UPDATE SET server_url = EXCLUDED.server_url;
