# Release manager composition

Copy `release-manager.ts` to `brain.ts` on a work branch. Run `brain check`,
review the diff, and merge to main. This complete composition demonstrates
subscriptions, event handling, relevance, a custom tier, turn hooks, an
in-process MCP tool, a schedule handled in code, and outbound middleware.
It uses the existing persona, style guides, prompts, memory and spend cap.
