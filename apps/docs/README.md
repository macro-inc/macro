# Macro Docs

This directory contains the Mintlify site for `docs.macro.com`.

## Local development

```bash
cd apps/docs
bun install
bun run generate:tools
bun run dev
```

Mintlify currently requires an LTS Node release for CLI commands. If the CLI rejects your runtime, switch to Node 20 or Node 22 before running `mint dev` or `mint broken-links`.

## How it works

- Handwritten pages live directly in `apps/docs/`
- Generated MCP tool pages are written to `apps/docs/AI/mcp/tools/`
- The generator rebuilds Rust tool schemas from `crates/ai_tools`

## Mintlify monorepo setup

Configure the Mintlify project as a monorepo and set the docs path to:

```text
/apps/docs
```
