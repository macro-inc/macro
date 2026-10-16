---
description: "Lexical nodes bump the version counter on breaking changes and render at their final height on first paint."
paths:
  - "packages/lexical-core/nodes/**"
  - "apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/**"
  - "apps/web/src/lib/core/component/LexicalMarkdown/version.ts"
globs: "packages/lexical-core/nodes/**,apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/**,apps/web/src/lib/core/component/LexicalMarkdown/version.ts"
alwaysApply: false
---

# Lexical nodes

## Bump the version counter

When you create a Lexical node or make a breaking change to one, increment the
counter in `apps/web/src/lib/core/component/LexicalMarkdown/version.ts` with a short
note on what changed.

## Keep decorators at a stable height

Any decorator node can appear in a channel message. Channels are a virtualized
list anchored to the bottom, so a message that grows after it mounts pushes
every row and the channel visibly jumps.

- Render the decorator at its final size on first paint. Reserve the box before
  data arrives: known width/height or `aspect-ratio` for media, a fixed-height
  placeholder for anything fetched.
- A loading state and its loaded state must be the same height.
  `MediaLoadingPlaceholder` and `LazyDecorator`'s `placeholder` slot are the
  existing ways to do this.
- Do not fetch or resolve something after mount that adds rows, previews, or
  expanded content unless its space is already reserved.

Check: open a channel with the node in an older message, reload, and confirm the
scroll position does not move while the node loads.
