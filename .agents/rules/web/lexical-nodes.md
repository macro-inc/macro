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

## Tag writes the person did not make

A decorator or plugin that writes on its own (saving a size it measured, a URL
it resolved, data it loaded) tags the update with `BACKGROUND_UPDATE_TAGS` from
`@macro-inc/lexical-core` and writes only when the value changed, never just
because it mounted. Lexical keeps a blurred editor's selection, and an untagged
update writes it back into the page. Our Lexical patch stops that while focus
is in another text field, but from a button, a menu or the page body the write
still moves focus into the editor.

## Move focus before moving the caret between fields

Lexical is patched (`apps/web/patches/lexical-0.45.0.patch`) so an editor
never writes its selection into the page while focus is in another text field
(an input, a textarea, another contenteditable), unless `editor.focus()` asks.
Code that moves the caret from one field into an editor (between the document
title and body, both ways) focuses the editor's root, or calls
`editor.focus()`, before or with the update.
