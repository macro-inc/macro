# Nested list-item DOM boundary

Pinned Lexical0.45.0 `LexicalListItemNode.ts` updateListItemChecked613-635
assigns checkbox role, tabIndex and aria-checked only when the parent is a check
list and the first child is not a list. Its theme function557-611 independently
adds checked/unchecked classes for a check-list parent and the nested-item class
when any child is a list. Wrappers retain this theme policy while suppressing
checkbox attributes.

The fixture imports an unchanged actual Source-exported task-list seed into both
the real Source editor (TaskListNode/ListItemNode/ListNode) and the matching44de
native session/view. It compares every list item's literal role, aria-checked,
tabindex, class and text. Full DOM strings are captured independently; the test
does not claim full list HTML equality, application controls, interactions or a
preview installation. No model graph, selection or constructor authority is
fabricated.

Run `browser-test/list-item-wrapper.playwright.config.ts` from this package with
an own read-only bind of all five sealed44de files at the app document-session
WASM path, independent output/report paths and the three real browser executable
paths. Keep the exact Source dependencies pristine. The verifier binds each run
to this package's `node_modules/.vite-list-wrapper/deps` source maps and served
script responses; configure `LEXICAL_WASM_VIEW_TEST_CACHE_DIR` to that same own
cache directory. Raw pre-fix failures and post-fix captures remain separate.
