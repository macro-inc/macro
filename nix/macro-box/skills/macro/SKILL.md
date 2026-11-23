---
name: macro
description: Read and change the team's Macro workspace (documents, channels, email, tasks, calendar, databases) from this computer through the Macro MCP server or the @macro-inc/sdk TypeScript SDK.
---

# Macro MCP and SDK

- Sessions macrod starts already have the team's Macro MCP server; check
  your tools for `mcp__macro__*`. With code mode, call `DescribeCodeTools`
  with the task, read the symbols with `ReadCodeDocs`, then do the whole job in
  one `ExecuteCode` program.
- For scripts and apps on this machine, use the SDK:
  `npm install @macro-inc/sdk`. Read its README before guessing methods;
  methods take entity handles, not raw id strings.
- Link Macro items as `https://macro.com/app/<type>/<id>` (`md`, `channel`,
  `chat`, `project`, `task`, `email`, `database`).
- You act as the person or agent identity that prompted you; only touch what
  the task needs.
