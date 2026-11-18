# Markdown documents

The block and Drive detail share `MarkdownDocumentContent`. Document loaders wait
for `rust-editor-model` before creating a connection. The flag is opt-in via
PostHog or `VITE_ENABLE_RUST_EDITOR_MODEL=true`; no remote rollout is changed by
this code. Reopen an existing document after changing its model flag, so its WAL
owner remains stable for the open session.

Off uses the existing Notebook, LexicalMarkdown plugins, LoroManager and
CollabProvider. On lazy-loads RustMarkdownEditor, initializes the session WASM on
the main thread, and connects EditorView through SessionPort/SessionExecutor.
Native code owns retries, authorization, WAL and cross-tab adoption. App code
supplies current-account authority and the configured socket URL. The document body forwards its existing cached-snapshot loader into the native factory; cached S3 bytes, IDB and the socket race through native recovery rather than SetState.
Use `EditorSession.createMacroWithNamespace` (through `createRustEditorSession`) so persisted Macro nodes and mirror null fields
match the live sync policy; the generic constructor is for portable clients.

Flagged browser documents use the same account/epoch-fenced offline metadata
cache as native documents. Reconnects always request fresh credentials; cached
permission permits private offline work, never replay of a persisted token.
Logout invalidates the cache epoch before asynchronous clearing.
Offline reopen requires a completed local body snapshot; metadata and WAL alone
must not bootstrap an editable empty document. The browser test waits for that
read-only storage checkpoint before disconnecting.

`editor.open` is a loading flow with `wasm.init`, `state.load` and
`view.reconcile` phases. Close drains native terminal storage before releasing
its lease. Cancelled async opens cannot mount into another document/account.
Keep session WASM and its optional view imports outside the flag-off startup
path; never initialize a worker eagerly.

The native registry includes document mentions and document cards through their
view-owned typed hosts. Both use the same live body interaction policy as media
and release subscriptions with the editor. Card layout notifications remain
absent until a real native layout owner is supplied. Render/selection leaf
comparisons do not establish app navigation or conversion acceptance; run the
matched frontend and native package with both registry rows enabled.
